package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"

	"xensql/internal/database"
)

func init() {
	database.Register(&Driver{})
}

type Driver struct{}

func (d *Driver) Type() database.DriverType { return database.DriverSQLite }

func (d *Driver) TestConnection(ctx context.Context, cfg database.ConnectionConfig) error {
	s, err := d.Connect(ctx, cfg)
	if err != nil {
		return err
	}
	defer s.Close()
	return s.Ping(ctx)
}

func (d *Driver) Connect(ctx context.Context, cfg database.ConnectionConfig) (database.Session, error) {
	if cfg.FilePath == "" {
		return nil, fmt.Errorf("sqlite file path is required")
	}
	db, err := sql.Open("sqlite", buildSQLiteDSN(cfg))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Session{db: db, readOnly: cfg.ReadOnly}, nil
}

// buildSQLiteDSN treats FilePath as an opaque path (any `?` query is dropped to block PRAGMA/mode=ro/vfs
// injection) and enforces read-only at the connection, not just via the SQL classifier.
func buildSQLiteDSN(cfg database.ConnectionConfig) string {
	path := cfg.FilePath
	if i := strings.IndexByte(path, '?'); i >= 0 {
		path = path[:i]
	}
	params := []string{"_foreign_keys=on"}
	if cfg.ReadOnly {
		params = append(params, "_pragma=query_only(true)")
	}
	return path + "?" + strings.Join(params, "&")
}

type Session struct {
	db *sql.DB
	// Defense-in-depth against future code paths that bypass the app-layer gate.
	readOnly bool
}

func (s *Session) DriverType() database.DriverType { return database.DriverSQLite }

func (s *Session) Close() error { return s.db.Close() }

func (s *Session) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

func (s *Session) ConnectionInfo(ctx context.Context) (database.ConnectionStatus, error) {
	return database.ConnectionStatus{
		Connected: true,
		Database:  "main",
		Schema:    "main",
		User:      "",
	}, nil
}

func (s *Session) BeginTxn(ctx context.Context) (database.PinnedTxn, error) {
	return database.NewPinnedTxn(ctx, s.db, database.DriverSQLite, nil)
}

func (s *Session) PinnedConn(ctx context.Context) (database.PinnedConn, error) {
	return database.NewPinnedConn(ctx, s.db, database.DriverSQLite, nil)
}

func (s *Session) Execute(ctx context.Context, sqlText string) (*database.QueryResult, error) {
	return database.CollectExecute(func(opts database.StreamOpts) (*database.QueryResult, error) {
		return s.ExecuteStream(ctx, sqlText, opts)
	})
}

func (s *Session) ExecuteStream(ctx context.Context, sqlText string, opts database.StreamOpts) (*database.QueryResult, error) {
	if s.readOnly {
		if err := database.AssertReadOnlySQL(sqlText); err != nil {
			return nil, err
		}
	}
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	return database.RunStatement(ctx, conn, database.DriverSQLite, sqlText, opts)
}

func (s *Session) ListSchemas(ctx context.Context) ([]database.SchemaInfo, error) {
	return []database.SchemaInfo{{Name: "main"}}, nil
}

func (s *Session) ListTables(ctx context.Context, schema string) ([]database.TableInfo, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT type, name FROM sqlite_master
		WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
		ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tables []database.TableInfo
	for rows.Next() {
		var typ, name string
		if err := rows.Scan(&typ, &name); err != nil {
			return nil, err
		}
		tables = append(tables, database.TableInfo{Schema: "main", Name: name, Type: typ})
	}
	return tables, rows.Err()
}

func (s *Session) ListColumns(ctx context.Context, schema, table string) ([]database.ColumnInfo, error) {
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info(%s)", database.QuoteIdent(database.DriverSQLite, table)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []database.ColumnInfo
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols = append(cols, database.ColumnInfo{
			Name:       name,
			DataType:   ctype,
			IsNullable: notnull == 0,
			IsPrimary:  pk > 0,
			DefaultVal: dflt.String,
		})
	}
	return cols, rows.Err()
}

func (s *Session) QueryTable(ctx context.Context, req database.TableDataRequest) (*database.QueryResult, error) {
	return database.CollectExecute(func(opts database.StreamOpts) (*database.QueryResult, error) {
		return s.QueryTableStream(ctx, req, opts)
	})
}

func (s *Session) QueryTableStream(ctx context.Context, req database.TableDataRequest, opts database.StreamOpts) (*database.QueryResult, error) {
	// ValidateTableFilter enforces read-only-by-construction even on writable connections; run unconditionally.
	if err := database.ValidateTableFilter(req.Filter); err != nil {
		return nil, err
	}
	cols, err := s.ListColumns(ctx, req.Schema, req.Table)
	if err != nil {
		return nil, err
	}
	pks := database.PrimaryKeys(cols)
	q := database.BuildTableSelectSQL(database.DriverSQLite, req.Schema, req, cols, pks)

	start := database.NowMs()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	result := &database.QueryResult{
		PrimaryKeys: pks,
		TableName:   req.Table,
		SchemaName:  "main",
	}
	return database.StreamQueryRows(ctx, conn, q, start, opts, result)
}

func (s *Session) UpdateRow(ctx context.Context, upd database.RowUpdate) error {
	if s.readOnly {
		return database.ErrReadOnly
	}
	cols, err := s.ListColumns(ctx, upd.Schema, upd.Table)
	if err != nil {
		return err
	}
	return database.ApplyRowUpdate(ctx, s.db.ExecContext, database.DriverSQLite, upd.Schema, upd, cols)
}

func (s *Session) DeleteRows(ctx context.Context, del database.RowDelete) (int64, error) {
	if s.readOnly {
		return 0, database.ErrReadOnly
	}
	cols, err := s.ListColumns(ctx, del.Schema, del.Table)
	if err != nil {
		return 0, err
	}
	return database.ApplyRowDeletes(ctx, s.db.ExecContext, database.DriverSQLite, del.Schema, del, cols)
}

func (s *Session) InsertRow(ctx context.Context, schema, table string, values map[string]interface{}) (map[string]interface{}, error) {
	if s.readOnly {
		return nil, database.ErrReadOnly
	}
	q, args, err := database.BuildInsertSQL(database.DriverSQLite, schema, table, values)
	if err != nil {
		return nil, err
	}
	res, err := s.db.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	// Re-fetch for full record (defaults, computed cols), matching Postgres RETURNING *.
	if id > 0 {
		return s.fetchInsertedRow(ctx, schema, table, id)
	}
	if row, ok := tryFetchInsertedByValues(ctx, s.db, table, values); ok {
		return row, nil
	}
	return map[string]interface{}{}, nil
}

// Looks up by INTEGER PK using the SQLite rowid; falls back to {"rowid": id} on failure.
func (s *Session) fetchInsertedRow(ctx context.Context, schema, table string, rowid int64) (map[string]interface{}, error) {
	cols, err := s.ListColumns(ctx, schema, table)
	if err == nil {
		if pkCol := database.FirstIntegerPrimaryKey(cols); pkCol != "" {
			if row, ok := database.SelectSingleRow(ctx, s.db,
				fmt.Sprintf("SELECT * FROM %s WHERE %s = ? LIMIT 1",
					database.QuoteIdent(database.DriverSQLite, table),
					database.QuoteIdent(database.DriverSQLite, pkCol)),
				rowid); ok {
				return row, nil
			}
		}
	}
	return map[string]interface{}{"rowid": rowid}, nil
}

// Fallback for LastInsertId==0 (non-INTEGER PK): exact-match lookup on the user-supplied values.
func tryFetchInsertedByValues(ctx context.Context, db *sql.DB, table string, values map[string]interface{}) (map[string]interface{}, bool) {
	if len(values) == 0 {
		return nil, false
	}
	where := make([]string, 0, len(values))
	args := make([]interface{}, 0, len(values))
	for col, val := range values {
		where = append(where, fmt.Sprintf("%s = ?", database.QuoteIdent(database.DriverSQLite, col)))
		args = append(args, val)
	}
	q := fmt.Sprintf("SELECT * FROM %s WHERE %s LIMIT 1",
		database.QuoteIdent(database.DriverSQLite, table),
		strings.Join(where, " AND "))
	return database.SelectSingleRow(ctx, db, q, args...)
}
