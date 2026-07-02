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
	return database.ConnectAndPing(ctx, d, cfg)
}

func (d *Driver) Connect(ctx context.Context, cfg database.ConnectionConfig) (database.Session, error) {
	database.NormalizeConnectionConfig(&cfg)
	if err := database.ValidateConnectionConfig(cfg); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", buildSQLiteDSN(cfg))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := database.PingOrClose(ctx, db, 0); err != nil {
		return nil, err
	}
	s := &Session{}
	s.SessionBase = database.SessionBase{
		DB:            db,
		Driver:        database.DriverSQLite,
		DefaultSchema: "main",
		ReadOnly:      cfg.ReadOnly,
		ListCols:      s.ListColumns,
	}
	return s, nil
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

// Session keeps only SQLite-specific behaviour; everything shared lives in database.SessionBase.
type Session struct {
	database.SessionBase
}

func (s *Session) ConnectionInfo(ctx context.Context) (database.ConnectionStatus, error) {
	return database.ConnectionStatus{
		Connected: true,
		Database:  "main",
		Schema:    "main",
		User:      "",
	}, nil
}

func (s *Session) ListSchemas(ctx context.Context) ([]database.SchemaInfo, error) {
	return []database.SchemaInfo{{Name: "main"}}, nil
}

func (s *Session) ListTables(ctx context.Context, schema string) ([]database.TableInfo, error) {
	rows, err := s.DB.QueryContext(ctx, `
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
	fkCols, err := s.foreignKeyColumns(ctx, table)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info(%s)", database.QuoteIdent(database.DriverSQLite, table)))
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
			IsForeign:  fkCols[name],
			DefaultVal: dflt.String,
		})
	}
	return cols, rows.Err()
}

// foreignKeyColumns returns the set of local column names that participate in a foreign key.
// PRAGMA table_info doesn't expose foreign keys, so they come from PRAGMA foreign_key_list.
func (s *Session) foreignKeyColumns(ctx context.Context, table string) (map[string]bool, error) {
	rows, err := s.DB.QueryContext(ctx, fmt.Sprintf("PRAGMA foreign_key_list(%s)", database.QuoteIdent(database.DriverSQLite, table)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fks := make(map[string]bool)
	for rows.Next() {
		var id, seq int
		var refTable, from string
		var to sql.NullString // null when the FK references the target's primary key implicitly
		var onUpdate, onDelete, matchType string
		if err := rows.Scan(&id, &seq, &refTable, &from, &to, &onUpdate, &onDelete, &matchType); err != nil {
			return nil, err
		}
		fks[from] = true
	}
	return fks, rows.Err()
}

func (s *Session) InsertRow(ctx context.Context, schema, table string, values map[string]any) (map[string]any, error) {
	if s.ReadOnly {
		return nil, database.ErrReadOnly
	}
	q, args, err := database.BuildInsertSQL(database.DriverSQLite, schema, table, values)
	if err != nil {
		return nil, err
	}
	res, err := s.DB.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	// Re-fetch for the full record (defaults, computed cols), matching Postgres RETURNING *.
	if id > 0 {
		return s.fetchInsertedRow(ctx, schema, table, id)
	}
	if row, ok := s.fetchInsertedByValues(ctx, table, values); ok {
		return row, nil
	}
	return map[string]any{}, nil
}

// fetchInsertedRow looks the row up by integer PK using the SQLite rowid, falling back to
// {"rowid": id} on failure.
func (s *Session) fetchInsertedRow(ctx context.Context, schema, table string, rowid int64) (map[string]any, error) {
	if cols, err := s.ListColumns(ctx, schema, table); err == nil {
		if row, ok := database.SelectRowByIntegerPK(ctx, s.DB, database.DriverSQLite, schema, table, cols, rowid); ok {
			return row, nil
		}
	}
	return map[string]any{"rowid": rowid}, nil
}

// fetchInsertedByValues is the fallback for LastInsertId==0 (non-INTEGER PK): an exact-match
// lookup on the user-supplied values.
func (s *Session) fetchInsertedByValues(ctx context.Context, table string, values map[string]any) (map[string]any, bool) {
	if len(values) == 0 {
		return nil, false
	}
	where := make([]string, 0, len(values))
	args := make([]any, 0, len(values))
	for col, val := range values {
		where = append(where, fmt.Sprintf("%s = ?", database.QuoteIdent(database.DriverSQLite, col)))
		args = append(args, val)
	}
	q := fmt.Sprintf("SELECT * FROM %s WHERE %s LIMIT 1",
		database.QuoteIdent(database.DriverSQLite, table),
		strings.Join(where, " AND "))
	return database.SelectSingleRow(ctx, s.DB, q, args...)
}
