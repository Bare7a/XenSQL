package database

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type execFunc func(ctx context.Context, query string, args ...any) (sql.Result, error)

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

// execSummary is the QueryResult for a statement executed without reading rows.
func execSummary(res sql.Result, startMs int64) *QueryResult {
	affected, _ := res.RowsAffected()
	return &QueryResult{
		AffectedRows: affected,
		DurationMs:   NowMs() - startMs,
		Message:      fmt.Sprintf("%d row(s) affected", affected),
	}
}

// runStatement routes row-returning SQL (same predicate as the script path, so TABLE/VALUES/CALL
// surface rows) through the streaming scan, everything else through Exec.
func runStatement(ctx context.Context, conn *sql.Conn, driver DriverType, sqlText string, opts StreamOpts) (*QueryResult, error) {
	start := NowMs()
	upper := strings.ToUpper(StripLeadingComments(sqlText))
	if statementReturnsRows(driver, upper) {
		return streamQueryRows(ctx, conn, sqlText, start, opts, &QueryResult{})
	}
	res, err := conn.ExecContext(ctx, sqlText)
	if err != nil {
		return nil, err
	}
	return execSummary(res, start), nil
}

func streamQueryRows(ctx context.Context, conn *sql.Conn, query string, startMs int64, opts StreamOpts, result *QueryResult) (*QueryResult, error) {
	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	total, err := ScanRowsStream(ctx, rows, wrapStreamMeta(opts, result))
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
	OnBatch   func(resultIndex int, rows [][]any) error
	OnResult  func(resultIndex int, summary *QueryResult, statement string, err error)
}

// RunScript executes statements in order on a single connection, streaming every result set
// (including extra sets surfaced by rows.NextResultSet, e.g. a stored procedure) to sink with a
// running global result index. It stops at the first statement that errors and returns that error.
func RunScript(ctx context.Context, conn *sql.Conn, driver DriverType, statements []string, sink ScriptSink) error {
	resultIndex := 0
	for _, stmt := range statements {
		if err := runScriptStatement(ctx, conn, driver, stmt, &resultIndex, sink); err != nil {
			return err
		}
	}
	return nil
}

func runScriptStatement(ctx context.Context, conn *sql.Conn, driver DriverType, stmt string, resultIndex *int, sink ScriptSink) error {
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
	sink.OnResult(idx, execSummary(res, start), stmt, nil)
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

// streamOneResultSet scans the current result set of rows through the shared scan loop, adapting
// the per-set ScriptSink callbacks to StreamOpts and returning the set's summary.
func streamOneResultSet(ctx context.Context, rows *sql.Rows, batchSize, resultIndex int, sink ScriptSink) (*QueryResult, error) {
	summary := &QueryResult{}
	opts := StreamOpts{BatchSize: batchSize}
	if sink.OnMeta != nil {
		opts.OnMeta = func(cols, types []string) { sink.OnMeta(resultIndex, cols, types) }
	}
	if sink.OnBatch != nil {
		opts.OnBatch = func(batch [][]any) error { return sink.OnBatch(resultIndex, batch) }
	}
	total, err := ScanRowsStream(ctx, rows, wrapStreamMeta(opts, summary))
	summary.RowCount = total
	return summary, err
}

// statementReturnsRows decides whether a statement should run via the query protocol (so its result
// sets - and any extra ones via NextResultSet - are read) rather than Exec. Mirrors IsSelectLike but
// also covers stored-procedure calls, which can return one or more result sets.
func statementReturnsRows(driver DriverType, upper string) bool {
	if IsSelectLike(driver, upper) || hasReturningClause(upper) {
		return true
	}
	return strings.HasPrefix(upper, "CALL") ||
		strings.HasPrefix(upper, "EXEC") ||
		strings.HasPrefix(upper, "VALUES") ||
		strings.HasPrefix(upper, "TABLE ")
}

func buildTableSelectSQL(driver DriverType, schema string, req TableDataRequest, cols []ColumnInfo, pks []string) string {
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
	// SQLite reads LIMIT -1 as "no limit" and Postgres rejects it; negative OFFSET errors everywhere.
	limit := req.Limit
	if limit <= 0 {
		limit = 100
	}
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}
	q += fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset)
	return q
}

func applyRowUpdate(ctx context.Context, exec execFunc, driver DriverType, schema string, upd RowUpdate, cols []ColumnInfo) error {
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

func applyRowDeletes(ctx context.Context, exec execFunc, driver DriverType, schema string, del RowDelete, cols []ColumnInfo) (int64, error) {
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

// SelectSingleRow runs query and returns its first row keyed by column name; ok is false when the
// query errors or returns no rows.
func SelectSingleRow(ctx context.Context, db *sql.DB, query string, args ...any) (map[string]any, bool) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, false
	}
	defer rows.Close()
	result, err := ScanRows(ctx, rows)
	if err != nil || len(result.Rows) == 0 {
		return nil, false
	}
	return FirstRowAsMap(result), true
}

// FirstRowAsMap returns the first row keyed by column name, or an empty map when there are no rows.
func FirstRowAsMap(result *QueryResult) map[string]any {
	row := make(map[string]any, len(result.Columns))
	if len(result.Rows) == 0 {
		return row
	}
	for i, col := range result.Columns {
		row[col] = result.Rows[0][i]
	}
	return row
}

// SelectRowByIntegerPK reselects the row whose (first) integer primary key equals id, so drivers
// that only get LastInsertId can return the full inserted record like Postgres RETURNING *.
// ok is false when the table has no integer primary key or the lookup fails.
func SelectRowByIntegerPK(ctx context.Context, db *sql.DB, driver DriverType, schema, table string, cols []ColumnInfo, id int64) (map[string]any, bool) {
	pk := firstIntegerPrimaryKey(cols)
	if pk == "" {
		return nil, false
	}
	query := fmt.Sprintf("SELECT * FROM %s WHERE %s = %s LIMIT 1",
		tableRef(driver, schema, table), QuoteIdent(driver, pk), Placeholder(driver, 1))
	return SelectSingleRow(ctx, db, query, id)
}

func firstIntegerPrimaryKey(cols []ColumnInfo) string {
	for _, c := range cols {
		if c.IsPrimary && strings.Contains(strings.ToLower(c.DataType), "int") {
			return c.Name
		}
	}
	return ""
}
