package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"

	"xensql/internal/database"
)

var systemSchemas = map[string]bool{
	"information_schema": true,
	"performance_schema": true,
	"mysql":              true,
	"sys":                true,
}

func init() {
	database.Register(&Driver{})
}

type Driver struct{}

func (d *Driver) Type() database.DriverType { return database.DriverMySQL }

func (d *Driver) TestConnection(ctx context.Context, cfg database.ConnectionConfig) error {
	return database.ConnectAndPing(ctx, d, cfg)
}

func (d *Driver) Connect(ctx context.Context, cfg database.ConnectionConfig) (database.Session, error) {
	database.NormalizeConnectionConfig(&cfg)
	if err := database.ValidateConnectionConfig(cfg); err != nil {
		return nil, err
	}
	// Open via the connector so the in-memory TLS config survives - FormatDSN()+sql.Open drops it (plaintext downgrade).
	connector, err := mysqldriver.NewConnector(buildConfig(cfg))
	if err != nil {
		return nil, err
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(10)
	if err := database.PingOrClose(ctx, db, 10*time.Second); err != nil {
		return nil, err
	}
	schema := cfg.Schema
	if schema == "" {
		schema = cfg.Database
	}
	s := &Session{}
	s.SessionBase = database.SessionBase{
		DB:            db,
		Driver:        database.DriverMySQL,
		DefaultSchema: schema,
		Host:          cfg.Host,
		ReadOnly:      cfg.ReadOnly,
		RegisterKill:  s.registerQueryKill,
		ListCols:      s.ListColumns,
	}
	return s, nil
}

// Session keeps only MySQL-specific behaviour; everything shared lives in database.SessionBase.
type Session struct {
	database.SessionBase
}

func (s *Session) registerQueryKill(ctx context.Context, conn *sql.Conn) error {
	return database.RegisterServerKill(ctx, conn, "SELECT CONNECTION_ID()", func(threadID int64) {
		// A `?` param would route KILL through the prepared-statement protocol, which MySQL rejects
		// (err 1295); threadID is a server-supplied int64, so interpolating it is injection-safe.
		_, _ = s.DB.ExecContext(context.Background(), fmt.Sprintf("KILL QUERY %d", threadID))
	})
}

func (s *Session) ConnectionInfo(ctx context.Context) (database.ConnectionStatus, error) {
	var dbName, user string
	err := s.DB.QueryRowContext(ctx, `SELECT DATABASE(), CURRENT_USER()`).Scan(&dbName, &user)
	if err != nil {
		return database.ConnectionStatus{}, err
	}
	schema := s.DefaultSchema
	if schema == "" {
		schema = dbName
	}
	return database.ConnectionStatus{
		Connected: true,
		Database:  dbName,
		Schema:    schema,
		User:      user,
		Host:      s.Host,
	}, nil
}

func (s *Session) ListSchemas(ctx context.Context) ([]database.SchemaInfo, error) {
	rows, err := s.DB.QueryContext(ctx, "SHOW DATABASES")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var schemas []database.SchemaInfo
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		if systemSchemas[strings.ToLower(name)] {
			continue
		}
		schemas = append(schemas, database.SchemaInfo{Name: name})
	}
	return schemas, rows.Err()
}

func (s *Session) ListTables(ctx context.Context, schema string) ([]database.TableInfo, error) {
	schema = s.SchemaOr(schema)
	rows, err := s.DB.QueryContext(ctx, `
		SELECT TABLE_NAME,
			CASE TABLE_TYPE
				WHEN 'BASE TABLE' THEN 'table'
				WHEN 'VIEW' THEN 'view'
				ELSE LOWER(TABLE_TYPE)
			END
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ?
		  AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
		ORDER BY TABLE_NAME`, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tables []database.TableInfo
	for rows.Next() {
		var name, typ string
		if err := rows.Scan(&name, &typ); err != nil {
			return nil, err
		}
		tables = append(tables, database.TableInfo{
			Schema: schema,
			Name:   name,
			Type:   strings.ToLower(typ),
		})
	}
	return tables, rows.Err()
}

func (s *Session) ListColumns(ctx context.Context, schema, table string) ([]database.ColumnInfo, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, COALESCE(c.COLUMN_DEFAULT, ''), c.COLUMN_KEY,
			COALESCE((
				SELECT k.REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE k
				WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA
				  AND k.TABLE_NAME = c.TABLE_NAME
				  AND k.COLUMN_NAME = c.COLUMN_NAME
				  AND k.REFERENCED_TABLE_NAME IS NOT NULL
				LIMIT 1
			), ''),
			COALESCE((
				SELECT k.REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE k
				WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA
				  AND k.TABLE_NAME = c.TABLE_NAME
				  AND k.COLUMN_NAME = c.COLUMN_NAME
				  AND k.REFERENCED_TABLE_NAME IS NOT NULL
				LIMIT 1
			), '')
		FROM information_schema.COLUMNS c
		WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
		ORDER BY c.ORDINAL_POSITION`, s.SchemaOr(schema), table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []database.ColumnInfo
	for rows.Next() {
		var name, dtype, nullable, def, colKey, fkTable, fkColumn string
		if err := rows.Scan(&name, &dtype, &nullable, &def, &colKey, &fkTable, &fkColumn); err != nil {
			return nil, err
		}
		cols = append(cols, database.ColumnInfo{
			Name:          name,
			DataType:      dtype,
			IsNullable:    strings.EqualFold(nullable, "YES"),
			IsPrimary:     colKey == "PRI",
			IsForeign:     fkTable != "",
			ForeignTable:  fkTable,
			ForeignColumn: fkColumn,
			DefaultVal:    def,
		})
	}
	return cols, rows.Err()
}

func (s *Session) InsertRow(ctx context.Context, schema, table string, values map[string]any) (map[string]any, error) {
	if s.ReadOnly {
		return nil, database.ErrReadOnly
	}
	schema = s.SchemaOr(schema)
	q, args, err := database.BuildInsertSQL(database.DriverMySQL, schema, table, values)
	if err != nil {
		return nil, err
	}
	res, err := s.DB.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if id > 0 {
		// Re-fetch for the full record (defaults, computed cols), matching Postgres RETURNING *.
		if row, ok := s.reselectInserted(ctx, schema, table, id); ok {
			return row, nil
		}
		return map[string]any{"id": id}, nil
	}
	return map[string]any{}, nil
}

// reselectInserted is ok=false when no integer PK exists or the reselect fails; the caller falls
// back to the raw insert id.
func (s *Session) reselectInserted(ctx context.Context, schema, table string, id int64) (map[string]any, bool) {
	cols, err := s.ListColumns(ctx, schema, table)
	if err != nil {
		return nil, false
	}
	return database.SelectRowByIntegerPK(ctx, s.DB, database.DriverMySQL, schema, table, cols, id)
}
