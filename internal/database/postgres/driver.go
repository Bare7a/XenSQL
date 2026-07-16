package postgres

import (
	"context"
	"database/sql"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"xensql/internal/database"
)

func init() {
	database.Register(&Driver{})
}

type Driver struct{}

func (d *Driver) Type() database.DriverType { return database.DriverPostgres }

func (d *Driver) TestConnection(ctx context.Context, cfg database.ConnectionConfig) error {
	return database.ConnectAndPing(ctx, d, cfg)
}

func (d *Driver) Connect(ctx context.Context, cfg database.ConnectionConfig) (database.Session, error) {
	database.NormalizeConnectionConfig(&cfg)
	if err := database.ValidateConnectionConfig(cfg); err != nil {
		return nil, err
	}
	db, err := sql.Open("pgx", buildDSN(cfg))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	if err := database.PingOrClose(ctx, db, 10*time.Second); err != nil {
		return nil, err
	}
	schema := cfg.Schema
	if schema == "" {
		schema = "public"
	}
	// database/sql may use a different physical conn per call, so SET search_path must happen
	// per-conn (SetupConn), not here.
	s := &Session{}
	s.SessionBase = database.SessionBase{
		DB:            db,
		Driver:        database.DriverPostgres,
		DefaultSchema: schema,
		Host:          cfg.Host,
		ReadOnly:      cfg.ReadOnly,
		SetupConn:     s.setSearchPath,
		RegisterKill:  s.registerQueryKill,
		ListCols:      s.ListColumns,
	}
	return s, nil
}

// Session keeps only Postgres-specific behaviour; everything shared lives in database.SessionBase.
type Session struct {
	database.SessionBase
}

// setSearchPath must run on a checked-out *sql.Conn so the SET applies to the same physical
// connection as the query.
func (s *Session) setSearchPath(ctx context.Context, conn *sql.Conn) error {
	_, err := conn.ExecContext(ctx, "SET search_path TO "+database.QuoteIdent(database.DriverPostgres, s.DefaultSchema)+", public")
	return err
}

func (s *Session) registerQueryKill(ctx context.Context, conn *sql.Conn) error {
	return database.RegisterServerKill(ctx, conn, "SELECT pg_backend_pid()", func(pid int64) {
		_, _ = s.DB.ExecContext(context.Background(), "SELECT pg_cancel_backend($1)", pid)
	})
}

func (s *Session) ConnectionInfo(ctx context.Context) (database.ConnectionStatus, error) {
	var dbName, schema, user string
	err := s.DB.QueryRowContext(ctx,
		`SELECT current_database(), current_schema(), current_user`).
		Scan(&dbName, &schema, &user)
	if err != nil {
		return database.ConnectionStatus{}, err
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
	// Fully qualified to pg_catalog - search_path irrelevant, no per-call SET needed.
	rows, err := s.DB.QueryContext(ctx, `
		SELECT nspname FROM pg_catalog.pg_namespace
		WHERE nspname NOT LIKE 'pg_%'
		  AND nspname NOT IN ('information_schema')
		ORDER BY CASE WHEN nspname = 'public' THEN 0 ELSE 1 END, nspname`)
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
		schemas = append(schemas, database.SchemaInfo{Name: name})
	}
	return schemas, rows.Err()
}

func (s *Session) ListTables(ctx context.Context, schema string) ([]database.TableInfo, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT n.nspname, c.relname,
			CASE c.relkind
				WHEN 'r' THEN 'table'
				WHEN 'v' THEN 'view'
				WHEN 'm' THEN 'materialized view'
				WHEN 'f' THEN 'foreign table'
				WHEN 'p' THEN 'partitioned table'
				ELSE 'table'
			END
		FROM pg_catalog.pg_class c
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1
		  AND c.relkind IN ('r', 'v', 'm', 'f', 'p')
		ORDER BY c.relname`, s.SchemaOr(schema))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tables []database.TableInfo
	for rows.Next() {
		var sch, name, typ string
		if err := rows.Scan(&sch, &name, &typ); err != nil {
			return nil, err
		}
		tables = append(tables, database.TableInfo{
			Schema: sch,
			Name:   name,
			Type:   strings.ToLower(typ),
		})
	}
	return tables, rows.Err()
}

func (s *Session) ListColumns(ctx context.Context, schema, table string) ([]database.ColumnInfo, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT a.attname,
			pg_catalog.format_type(a.atttypid, a.atttypmod),
			NOT a.attnotnull,
			COALESCE(pg_catalog.pg_get_expr(ad.adbin, ad.adrelid), ''),
			EXISTS (
				SELECT 1 FROM pg_catalog.pg_constraint con
				WHERE con.conrelid = c.oid AND con.contype = 'p'
				  AND a.attnum = ANY (con.conkey)
			),
			COALESCE(fk.reftable, ''),
			COALESCE(fk.refcolumn, '')
		FROM pg_catalog.pg_attribute a
		JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
		JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
		LEFT JOIN pg_catalog.pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
		LEFT JOIN LATERAL (
			SELECT ref.relname AS reftable, refatt.attname AS refcolumn
			FROM pg_catalog.pg_constraint con
			JOIN pg_catalog.pg_class ref ON ref.oid = con.confrelid
			JOIN pg_catalog.pg_attribute refatt ON refatt.attrelid = con.confrelid
				AND refatt.attnum = con.confkey[array_position(con.conkey, a.attnum)]
			WHERE con.conrelid = c.oid AND con.contype = 'f'
			  AND a.attnum = ANY (con.conkey)
			LIMIT 1
		) fk ON true
		WHERE n.nspname = $1 AND c.relname = $2
		  AND a.attnum > 0 AND NOT a.attisdropped
		ORDER BY a.attnum`, s.SchemaOr(schema), table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []database.ColumnInfo
	for rows.Next() {
		var name, dtype string
		var nullable, isPK bool
		var def, fkTable, fkColumn string
		if err := rows.Scan(&name, &dtype, &nullable, &def, &isPK, &fkTable, &fkColumn); err != nil {
			return nil, err
		}
		cols = append(cols, database.ColumnInfo{
			Name:          name,
			DataType:      dtype,
			IsNullable:    nullable,
			IsPrimary:     isPK,
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
	base, args, err := database.BuildInsertSQL(database.DriverPostgres, s.SchemaOr(schema), table, values)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, base+" RETURNING *", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result, err := database.ScanRows(ctx, rows)
	if err != nil {
		return map[string]any{}, err
	}
	return database.FirstRowAsMap(result), nil
}
