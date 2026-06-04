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
	s, err := d.Connect(ctx, cfg)
	if err != nil {
		return err
	}
	defer s.Close()
	return s.Ping(ctx)
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
	// Fail fast on an unreachable host instead of hanging on the OS TCP timeout.
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, err
	}
	schema := cfg.Schema
	if schema == "" {
		schema = cfg.Database
	}
	return &Session{
		db:            db,
		defaultSchema: schema,
		host:          cfg.Host,
		readOnly:      cfg.ReadOnly,
	}, nil
}

type Session struct {
	db            *sql.DB
	defaultSchema string
	host          string
	// Defense-in-depth against future code paths that bypass the app-layer gate.
	readOnly bool
}

func (s *Session) DriverType() database.DriverType { return database.DriverMySQL }

func (s *Session) Close() error { return s.db.Close() }

func (s *Session) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

func (s *Session) registerQueryKill(ctx context.Context, conn *sql.Conn) error {
	connID, ok := database.ConnectionIDFromContext(ctx)
	if !ok {
		return nil
	}
	reg := database.QueryRegistryFromContext(ctx)
	if reg == nil {
		return nil
	}
	var threadID int64
	if err := conn.QueryRowContext(ctx, "SELECT CONNECTION_ID()").Scan(&threadID); err != nil {
		return err
	}
	reg.SetKill(connID, func() {
		// A `?` param would route KILL through the prepared-statement protocol, which MySQL rejects
		// (err 1295); threadID is a server-supplied int64, so interpolating it is injection-safe.
		_, _ = s.db.ExecContext(context.Background(), fmt.Sprintf("KILL QUERY %d", threadID))
	})
	return nil
}

func (s *Session) BeginTxn(ctx context.Context) (database.PinnedTxn, error) {
	return database.NewPinnedTxn(ctx, s.db, database.DriverMySQL, nil)
}

func (s *Session) PinnedConn(ctx context.Context) (database.PinnedConn, error) {
	return database.NewPinnedConn(ctx, s.db, database.DriverMySQL, nil)
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

	if err := s.registerQueryKill(ctx, conn); err != nil {
		return nil, err
	}
	return database.RunStatement(ctx, conn, database.DriverMySQL, sqlText, opts)
}

func (s *Session) ConnectionInfo(ctx context.Context) (database.ConnectionStatus, error) {
	var dbName, user string
	err := s.db.QueryRowContext(ctx, `SELECT DATABASE(), CURRENT_USER()`).Scan(&dbName, &user)
	if err != nil {
		return database.ConnectionStatus{}, err
	}
	schema := s.defaultSchema
	if schema == "" {
		schema = dbName
	}
	return database.ConnectionStatus{
		Connected: true,
		Database:  dbName,
		Schema:    schema,
		User:      user,
		Host:      s.host,
	}, nil
}

func (s *Session) ListSchemas(ctx context.Context) ([]database.SchemaInfo, error) {
	rows, err := s.db.QueryContext(ctx, "SHOW DATABASES")
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
	if schema == "" {
		schema = s.defaultSchema
	}
	rows, err := s.db.QueryContext(ctx, `
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
	if schema == "" {
		schema = s.defaultSchema
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COALESCE(COLUMN_DEFAULT, ''), COLUMN_KEY
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY ORDINAL_POSITION`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []database.ColumnInfo
	for rows.Next() {
		var name, dtype, nullable, def, colKey string
		if err := rows.Scan(&name, &dtype, &nullable, &def, &colKey); err != nil {
			return nil, err
		}
		cols = append(cols, database.ColumnInfo{
			Name:       name,
			DataType:   dtype,
			IsNullable: strings.EqualFold(nullable, "YES"),
			IsPrimary:  colKey == "PRI",
			DefaultVal: def,
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
	if err := database.ValidateTableFilter(req.Filter); err != nil {
		return nil, err
	}
	schema := req.Schema
	if schema == "" {
		schema = s.defaultSchema
	}
	cols, err := s.ListColumns(ctx, schema, req.Table)
	if err != nil {
		return nil, err
	}
	pks := database.PrimaryKeys(cols)
	q := database.BuildTableSelectSQL(database.DriverMySQL, schema, req, cols, pks)

	start := database.NowMs()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if err := s.registerQueryKill(ctx, conn); err != nil {
		return nil, err
	}
	result := &database.QueryResult{
		PrimaryKeys: pks,
		TableName:   req.Table,
		SchemaName:  schema,
	}
	return database.StreamQueryRows(ctx, conn, q, start, opts, result)
}

func (s *Session) UpdateRow(ctx context.Context, upd database.RowUpdate) error {
	if s.readOnly {
		return database.ErrReadOnly
	}
	schema := upd.Schema
	if schema == "" {
		schema = s.defaultSchema
	}
	cols, err := s.ListColumns(ctx, schema, upd.Table)
	if err != nil {
		return err
	}
	return database.ApplyRowUpdate(ctx, s.db.ExecContext, database.DriverMySQL, schema, upd, cols)
}

func (s *Session) DeleteRows(ctx context.Context, del database.RowDelete) (int64, error) {
	if s.readOnly {
		return 0, database.ErrReadOnly
	}
	schema := del.Schema
	if schema == "" {
		schema = s.defaultSchema
	}
	cols, err := s.ListColumns(ctx, schema, del.Table)
	if err != nil {
		return 0, err
	}
	return database.ApplyRowDeletes(ctx, s.db.ExecContext, database.DriverMySQL, schema, del, cols)
}

func (s *Session) InsertRow(ctx context.Context, schema, table string, values map[string]interface{}) (map[string]interface{}, error) {
	if s.readOnly {
		return nil, database.ErrReadOnly
	}
	if schema == "" {
		schema = s.defaultSchema
	}
	q, args, err := database.BuildInsertSQL(database.DriverMySQL, schema, table, values)
	if err != nil {
		return nil, err
	}
	res, err := s.db.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if id > 0 {
		if row, ok := s.fetchInsertedByIntPK(ctx, schema, table, id); ok {
			return row, nil
		}
		return map[string]interface{}{"id": id}, nil
	}
	return map[string]interface{}{}, nil
}

// Returns (nil,false) when no INTEGER PK exists or the reselect fails; caller falls back to the raw insert id.
func (s *Session) fetchInsertedByIntPK(ctx context.Context, schema, table string, id int64) (map[string]interface{}, bool) {
	cols, err := s.ListColumns(ctx, schema, table)
	if err != nil {
		return nil, false
	}
	pkCol := database.FirstIntegerPrimaryKey(cols)
	if pkCol == "" {
		return nil, false
	}
	return database.SelectSingleRow(ctx, s.db,
		fmt.Sprintf("SELECT * FROM %s WHERE %s = ? LIMIT 1",
			database.BuildQualifiedTable(database.DriverMySQL, schema, table),
			database.QuoteIdent(database.DriverMySQL, pkCol)),
		id)
}
