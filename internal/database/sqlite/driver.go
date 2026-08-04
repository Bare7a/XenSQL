package sqlite

import (
	"context"
	"database/sql"
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

// Session keeps only SQLite-specific behaviour; everything shared lives in database.SessionBase and
// the SQLite-family catalog helpers.
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
	return database.SQLiteListTables(ctx, s.DB)
}

func (s *Session) ListColumns(ctx context.Context, schema, table string) ([]database.ColumnInfo, error) {
	return database.SQLiteListColumns(ctx, s.DB, database.DriverSQLite, table)
}

func (s *Session) InsertRow(ctx context.Context, schema, table string, values map[string]any) (map[string]any, error) {
	if s.ReadOnly {
		return nil, database.ErrReadOnly
	}
	return database.SQLiteInsertRow(ctx, s.DB, database.DriverSQLite, schema, table, values)
}
