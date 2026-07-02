package database

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

func NowMs() int64 {
	return time.Now().UnixMilli()
}

var returningRe = regexp.MustCompile(`(?i)\bRETURNING\b`)

// Mask comments/strings first so a literal like VALUES('RETURNING') doesn't misroute a write.
func hasReturningClause(upper string) bool {
	return returningRe.MatchString(maskStringLiterals(stripSQLComments(upper)))
}

// ScanRows collects every row into a single QueryResult. Honours ctx cancellation so a UI Cancel
// aborts mid-stream, not after the buffer drains.
func ScanRows(ctx context.Context, rows *sql.Rows) (*QueryResult, error) {
	result := &QueryResult{Rows: make([][]any, 0, 128)}
	opts := wrapStreamMeta(StreamOpts{
		OnBatch: func(batch [][]any) error {
			result.Rows = append(result.Rows, batch...)
			return nil
		},
	}, result)
	total, err := ScanRowsStream(ctx, rows, opts)
	if err != nil {
		return nil, err
	}
	result.RowCount = total
	return result, nil
}

type StreamOpts struct {
	BatchSize int // rows per OnBatch call; default 5000
	OnMeta    func(columns []string, columnTypes []string)
	OnBatch   func(batch [][]any) error // returning error aborts the scan
}

const defaultStreamBatchSize = 5000

// wrapStreamMeta populates into.Columns/ColumnTypes from the OnMeta callback while still forwarding
// to any caller-supplied OnMeta.
func wrapStreamMeta(opts StreamOpts, into *QueryResult) StreamOpts {
	userMeta := opts.OnMeta
	opts.OnMeta = func(cols, types []string) {
		into.Columns = cols
		into.ColumnTypes = types
		if userMeta != nil {
			userMeta(cols, types)
		}
	}
	return opts
}

// collectStream buffers a streaming run into a single Rows slice so buffered entry points
// (Execute, QueryTable) can wrap their streaming counterparts.
func collectStream(run func(StreamOpts) (*QueryResult, error)) (*QueryResult, error) {
	var rows [][]any
	opts := StreamOpts{
		OnBatch: func(batch [][]any) error {
			rows = append(rows, batch...)
			return nil
		},
	}
	result, err := run(opts)
	if result != nil {
		result.Rows = rows
	}
	return result, err
}

// ScanRowsStream is the single row-scan loop every read path funnels through: it normalizes
// values, checks ctx periodically, and delivers rows to OnBatch in BatchSize chunks.
func ScanRowsStream(ctx context.Context, rows *sql.Rows, opts StreamOpts) (int64, error) {
	batchSize := opts.BatchSize
	if batchSize <= 0 {
		batchSize = defaultStreamBatchSize
	}

	cols, err := rows.Columns()
	if err != nil {
		return 0, err
	}
	colTypes, _ := rows.ColumnTypes()
	typeNames := make([]string, len(cols))
	for i, ct := range colTypes {
		if ct != nil {
			typeNames[i] = ct.DatabaseTypeName()
		}
	}
	if opts.OnMeta != nil {
		opts.OnMeta(cols, typeNames)
	}

	// Reuse scratch arrays across rows; only the handed-back per-row slice is allocated.
	values := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range ptrs {
		ptrs[i] = &values[i]
	}

	// Checking ctx every row is overhead; every 1024 is plenty.
	const ctxCheckInterval = 1024
	var total int64
	batch := make([][]any, 0, batchSize)

	flush := func() error {
		if len(batch) == 0 || opts.OnBatch == nil {
			batch = batch[:0]
			return nil
		}
		if err := opts.OnBatch(batch); err != nil {
			return err
		}
		// Fresh slice so the consumer can retain the delivered batch safely.
		batch = make([][]any, 0, batchSize)
		return nil
	}

	for rows.Next() {
		if total%ctxCheckInterval == 0 {
			if err := ctx.Err(); err != nil {
				return total, err
			}
		}
		if err := rows.Scan(ptrs...); err != nil {
			return total, err
		}
		row := make([]any, len(cols))
		for i, v := range values {
			row[i] = normalizeValue(v)
		}
		batch = append(batch, row)
		total++
		if len(batch) >= batchSize {
			if err := flush(); err != nil {
				return total, err
			}
		}
	}

	if err := rows.Err(); err != nil {
		// Prefer the ctx sentinel: some drivers surface context.Canceled via rows.Err().
		if ctxErr := ctx.Err(); ctxErr != nil {
			return total, ctxErr
		}
		return total, err
	}

	return total, flush()
}

// JS numbers are float64, so integers beyond this lose precision once marshaled to the frontend.
const maxSafeInteger = 1<<53 - 1

func normalizeValue(v any) any {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case []byte:
		if utf8.Valid(val) {
			return string(val)
		}
		// Binary/BLOB: hex-encode (\x style) so it can't render as mojibake or break TSV/CSV.
		return `\x` + hex.EncodeToString(val)
	case time.Time:
		return val.Format(time.RFC3339Nano)
	case int64:
		// Out-of-range ints → string so a bigint PK isn't silently rounded by the FE.
		if val > maxSafeInteger || val < -maxSafeInteger {
			return strconv.FormatInt(val, 10)
		}
		return val
	case uint64:
		if val > maxSafeInteger {
			return strconv.FormatUint(val, 10)
		}
		return val
	default:
		return val
	}
}

// Removes leading whitespace and comments so the first keyword is visible for prefix-based dispatch.
func StripLeadingComments(sql string) string {
	i := 0
	n := len(sql)
	for i < n {
		if sql[i] == ' ' || sql[i] == '\t' || sql[i] == '\n' || sql[i] == '\r' {
			i++
			continue
		}
		if i+1 < n && sql[i] == '-' && sql[i+1] == '-' {
			i += 2
			for i < n && sql[i] != '\n' {
				i++
			}
			continue
		}
		if i+1 < n && sql[i] == '/' && sql[i+1] == '*' {
			i += 2
			for i+1 < n && !(sql[i] == '*' && sql[i+1] == '/') {
				i++
			}
			if i+1 < n {
				i += 2
			} else {
				i = n
			}
			continue
		}
		break
	}
	return sql[i:]
}

func QuoteIdent(driver DriverType, ident string) string {
	switch driver {
	case DriverPostgres:
		return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
	case DriverMySQL:
		return "`" + strings.ReplaceAll(ident, "`", "``") + "`"
	default:
		return `"` + strings.ReplaceAll(ident, `"`, `""`) + `"`
	}
}

func BuildQualifiedTable(driver DriverType, schema, table string) string {
	if schema == "" {
		return QuoteIdent(driver, table)
	}
	return QuoteIdent(driver, schema) + "." + QuoteIdent(driver, table)
}

func Placeholder(driver DriverType, index int) string {
	if driver == DriverPostgres {
		return fmt.Sprintf("$%d", index)
	}
	return "?"
}

func PrimaryKeys(cols []ColumnInfo) []string {
	var pks []string
	for _, c := range cols {
		if c.IsPrimary {
			pks = append(pks, c.Name)
		}
	}
	return pks
}

// tableRef is the driver-aware table reference: SQLite tables are never schema-qualified.
func tableRef(driver DriverType, schema, table string) string {
	if driver == DriverSQLite {
		return QuoteIdent(driver, table)
	}
	return BuildQualifiedTable(driver, schema, table)
}

func BuildUpdateSQL(driver DriverType, schema, table string, changes, pkValues map[string]any, pkCols []string) (string, []any, error) {
	if len(changes) == 0 {
		return "", nil, fmt.Errorf("no changes to apply")
	}
	if err := requirePKValues(pkCols, pkValues); err != nil {
		return "", nil, err
	}
	sets := make([]string, 0, len(changes))
	args := make([]any, 0, len(changes)+len(pkCols))
	idx := 1
	for col, val := range changes {
		sets = append(sets, fmt.Sprintf("%s = %s", QuoteIdent(driver, col), Placeholder(driver, idx)))
		args = append(args, val)
		idx++
	}
	where := make([]string, 0, len(pkCols))
	for _, pk := range pkCols {
		where = append(where, fmt.Sprintf("%s = %s", QuoteIdent(driver, pk), Placeholder(driver, idx)))
		args = append(args, pkValues[pk])
		idx++
	}
	q := fmt.Sprintf("UPDATE %s SET %s WHERE %s",
		tableRef(driver, schema, table),
		strings.Join(sets, ", "),
		strings.Join(where, " AND "))
	return q, args, nil
}

func BuildDeleteSQL(driver DriverType, schema, table string, pkCols []string, pkRow map[string]any) (string, []any, error) {
	if err := requirePKValues(pkCols, pkRow); err != nil {
		return "", nil, err
	}
	where := make([]string, 0, len(pkCols))
	args := make([]any, 0, len(pkCols))
	for i, pk := range pkCols {
		where = append(where, fmt.Sprintf("%s = %s", QuoteIdent(driver, pk), Placeholder(driver, i+1)))
		args = append(args, pkRow[pk])
	}
	q := fmt.Sprintf("DELETE FROM %s WHERE %s",
		tableRef(driver, schema, table),
		strings.Join(where, " AND "))
	return q, args, nil
}

// requirePKValues ensures every primary-key column has a value, so a WHERE clause can never
// silently degrade to `pk = NULL` (which matches zero rows and reports a no-op as success).
func requirePKValues(pkCols []string, values map[string]any) error {
	if len(pkCols) == 0 {
		return fmt.Errorf("table has no primary key")
	}
	for _, pk := range pkCols {
		if _, ok := values[pk]; !ok {
			return fmt.Errorf("missing primary key value for %q", pk)
		}
	}
	return nil
}

// ColumnExists reports whether name matches a known column (used to drop an unknown ORDER BY).
func ColumnExists(cols []ColumnInfo, name string) bool {
	for _, c := range cols {
		if c.Name == name {
			return true
		}
	}
	return false
}

// Caller appends any driver-specific suffix (RETURNING *, ON CONFLICT, …).
func BuildInsertSQL(driver DriverType, schema, table string, values map[string]any) (string, []any, error) {
	if len(values) == 0 {
		return "", nil, fmt.Errorf("no column values provided")
	}
	cols := make([]string, 0, len(values))
	placeholders := make([]string, 0, len(values))
	args := make([]any, 0, len(values))
	idx := 1
	for col, val := range values {
		cols = append(cols, QuoteIdent(driver, col))
		placeholders = append(placeholders, Placeholder(driver, idx))
		args = append(args, val)
		idx++
	}
	q := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		tableRef(driver, schema, table),
		strings.Join(cols, ", "),
		strings.Join(placeholders, ", "))
	return q, args, nil
}
