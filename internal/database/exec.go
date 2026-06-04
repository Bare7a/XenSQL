package database

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type ExecFunc func(ctx context.Context, query string, args ...interface{}) (sql.Result, error)

func IsSelectLike(driver DriverType, upper string) bool {
	if strings.HasPrefix(upper, "SELECT") || strings.HasPrefix(upper, "WITH") || strings.HasPrefix(upper, "EXPLAIN") {
		return true
	}
	switch driver {
	case DriverSQLite:
		return strings.HasPrefix(upper, "PRAGMA")
	case DriverMySQL:
		return strings.HasPrefix(upper, "SHOW") ||
			strings.HasPrefix(upper, "DESCRIBE") ||
			strings.HasPrefix(upper, "DESC")
	default:
		return false
	}
}

func RunStatement(ctx context.Context, conn *sql.Conn, driver DriverType, sqlText string, opts StreamOpts) (*QueryResult, error) {
	start := NowMs()
	upper := strings.ToUpper(StripLeadingComments(sqlText))
	if IsSelectLike(driver, upper) || HasReturningClause(upper) {
		return StreamQueryRows(ctx, conn, sqlText, start, opts, &QueryResult{})
	}
	res, err := conn.ExecContext(ctx, sqlText)
	if err != nil {
		return nil, err
	}
	affected, _ := res.RowsAffected()
	return &QueryResult{
		AffectedRows: affected,
		DurationMs:   NowMs() - start,
		Message:      fmt.Sprintf("%d row(s) affected", affected),
	}, nil
}

func StreamQueryRows(ctx context.Context, conn *sql.Conn, query string, startMs int64, opts StreamOpts, result *QueryResult) (*QueryResult, error) {
	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	streamOpts := WrapStreamMeta(opts, result)
	total, err := ScanRowsStream(ctx, rows, streamOpts)
	result.RowCount = total
	result.DurationMs = NowMs() - startMs
	if err != nil {
		return result, err
	}
	return result, nil
}

// ScriptSink receives streamed result sets from RunScript, in execution order. Each row-returning
// set fires OnMeta once, then OnBatch zero or more times; every set ends with OnResult carrying its
// summary (columns/counts/message) and any error. resultIndex is global across all statements in
// the script, so one statement that yields several result sets advances it several times.
type ScriptSink struct {
	BatchSize int
	OnMeta    func(resultIndex int, columns, columnTypes []string)
	OnBatch   func(resultIndex int, rows [][]interface{}) error
	OnResult  func(resultIndex int, summary *QueryResult, statement string, err error)
}

// RunScript executes statements in order on a single connection, streaming every result set
// (including extra sets surfaced by rows.NextResultSet, e.g. a stored procedure) to sink with a
// running global result index. It stops at the first statement that errors and returns that error.
func RunScript(ctx context.Context, conn *sql.Conn, driver DriverType, statements []string, sink ScriptSink) error {
	resultIndex := 0
	for _, stmt := range statements {
		if err := runStatementInto(ctx, conn, driver, stmt, &resultIndex, sink); err != nil {
			return err
		}
	}
	return nil
}

func runStatementInto(ctx context.Context, conn *sql.Conn, driver DriverType, stmt string, resultIndex *int, sink ScriptSink) error {
	start := NowMs()
	upper := strings.ToUpper(StripLeadingComments(stmt))
	if statementReturnsRows(driver, upper) {
		return streamResultSets(ctx, conn, stmt, start, resultIndex, sink)
	}
	res, err := conn.ExecContext(ctx, stmt)
	idx := *resultIndex
	*resultIndex++
	if err != nil {
		sink.OnResult(idx, nil, stmt, err)
		return err
	}
	affected, _ := res.RowsAffected()
	sink.OnResult(idx, &QueryResult{
		AffectedRows: affected,
		DurationMs:   NowMs() - start,
		Message:      fmt.Sprintf("%d row(s) affected", affected),
	}, stmt, nil)
	return nil
}

// streamResultSets runs a row-returning statement and streams each of its result sets (the first
// plus any from NextResultSet) to sink, one OnResult per set.
func streamResultSets(ctx context.Context, conn *sql.Conn, query string, start int64, resultIndex *int, sink ScriptSink) error {
	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		idx := *resultIndex
		*resultIndex++
		sink.OnResult(idx, nil, query, err)
		return err
	}
	defer rows.Close()

	for {
		idx := *resultIndex
		*resultIndex++
		summary, scanErr := streamOneResultSet(ctx, rows, sink.BatchSize, idx, sink)
		summary.DurationMs = NowMs() - start
		if scanErr != nil {
			sink.OnResult(idx, summary, query, scanErr)
			return scanErr
		}
		sink.OnResult(idx, summary, query, nil)
		if !rows.NextResultSet() {
			break
		}
	}
	if err := rows.Err(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		return err
	}
	return nil
}

func streamOneResultSet(ctx context.Context, rows *sql.Rows, batchSize, resultIndex int, sink ScriptSink) (*QueryResult, error) {
	if batchSize <= 0 {
		batchSize = defaultStreamBatchSize
	}
	cols, err := rows.Columns()
	if err != nil {
		return &QueryResult{}, err
	}
	colTypes, _ := rows.ColumnTypes()
	typeNames := make([]string, len(cols))
	for i, ct := range colTypes {
		if ct != nil {
			typeNames[i] = ct.DatabaseTypeName()
		}
	}
	if sink.OnMeta != nil {
		sink.OnMeta(resultIndex, cols, typeNames)
	}
	summary := &QueryResult{Columns: cols, ColumnTypes: typeNames}

	values := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range ptrs {
		ptrs[i] = &values[i]
	}

	const ctxCheckInterval = 1024
	var total int64
	batch := make([][]interface{}, 0, batchSize)
	flush := func() error {
		if len(batch) == 0 || sink.OnBatch == nil {
			batch = batch[:0]
			return nil
		}
		if err := sink.OnBatch(resultIndex, batch); err != nil {
			return err
		}
		batch = make([][]interface{}, 0, batchSize)
		return nil
	}

	for rows.Next() {
		if total%ctxCheckInterval == 0 {
			if err := ctx.Err(); err != nil {
				summary.RowCount = total
				return summary, err
			}
		}
		if err := rows.Scan(ptrs...); err != nil {
			summary.RowCount = total
			return summary, err
		}
		row := make([]interface{}, len(cols))
		for i, v := range values {
			row[i] = normalizeValue(v)
		}
		batch = append(batch, row)
		total++
		if len(batch) >= batchSize {
			if err := flush(); err != nil {
				summary.RowCount = total
				return summary, err
			}
		}
	}
	summary.RowCount = total
	// rows.Next returning false ends this result set; rows.Err distinguishes end-of-set from failure.
	if err := rows.Err(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return summary, ctxErr
		}
		return summary, err
	}
	if err := flush(); err != nil {
		return summary, err
	}
	return summary, nil
}

// statementReturnsRows decides whether a statement should run via the query protocol (so its result
// sets - and any extra ones via NextResultSet - are read) rather than Exec. Mirrors IsSelectLike but
// also covers stored-procedure calls, which can return one or more result sets.
func statementReturnsRows(driver DriverType, upper string) bool {
	if IsSelectLike(driver, upper) || HasReturningClause(upper) {
		return true
	}
	return strings.HasPrefix(upper, "CALL") ||
		strings.HasPrefix(upper, "EXEC") ||
		strings.HasPrefix(upper, "VALUES") ||
		strings.HasPrefix(upper, "TABLE ")
}

func BuildTableSelectSQL(driver DriverType, schema string, req TableDataRequest, cols []ColumnInfo, pks []string) string {
	q := fmt.Sprintf("SELECT * FROM %s", tableRef(driver, schema, req.Table))
	if req.Filter != "" {
		q += " WHERE " + req.Filter
	}
	orderBy := req.OrderBy
	if orderBy != "" && !ColumnExists(cols, orderBy) {
		orderBy = "" // ignore an unknown client-supplied sort column instead of erroring
	}
	if orderBy == "" {
		if len(pks) > 0 {
			orderBy = pks[0]
		} else if len(cols) > 0 {
			orderBy = cols[0].Name
		}
	}
	if orderBy != "" {
		dir := "ASC"
		if strings.EqualFold(req.OrderDir, "DESC") {
			dir = "DESC"
		}
		q += fmt.Sprintf(" ORDER BY %s %s", QuoteIdent(driver, orderBy), dir)
	}
	q += fmt.Sprintf(" LIMIT %d OFFSET %d", req.Limit, req.Offset)
	return q
}

func ApplyRowUpdate(ctx context.Context, exec ExecFunc, driver DriverType, schema string, upd RowUpdate, cols []ColumnInfo) error {
	pks := PrimaryKeys(cols)
	if len(pks) == 0 {
		return fmt.Errorf("table has no primary key")
	}
	q, args, err := BuildUpdateSQL(driver, schema, upd.Table, upd.Changes, upd.PrimaryKey, pks)
	if err != nil {
		return err
	}
	_, err = exec(ctx, q, args...)
	return err
}

func ApplyRowDeletes(ctx context.Context, exec ExecFunc, driver DriverType, schema string, del RowDelete, cols []ColumnInfo) (int64, error) {
	pks := PrimaryKeys(cols)
	if len(pks) == 0 {
		return 0, fmt.Errorf("table has no primary key")
	}
	var total int64
	for _, pkRow := range del.PrimaryKeys {
		q, args, err := BuildDeleteSQL(driver, schema, del.Table, pks, pkRow)
		if err != nil {
			return total, err
		}
		res, err := exec(ctx, q, args...)
		if err != nil {
			return total, err
		}
		n, _ := res.RowsAffected()
		total += n
	}
	return total, nil
}

func SelectSingleRow(ctx context.Context, db *sql.DB, query string, args ...interface{}) (map[string]interface{}, bool) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, false
	}
	defer rows.Close()
	result, err := ScanRows(ctx, rows)
	if err != nil || len(result.Rows) == 0 {
		return nil, false
	}
	row := make(map[string]interface{}, len(result.Columns))
	for i, col := range result.Columns {
		row[col] = result.Rows[0][i]
	}
	return row, true
}

func FirstIntegerPrimaryKey(cols []ColumnInfo) string {
	for _, c := range cols {
		if c.IsPrimary && strings.Contains(strings.ToLower(c.DataType), "int") {
			return c.Name
		}
	}
	return ""
}
