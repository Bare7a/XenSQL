package database

import (
	"context"
	"database/sql"
	"time"
)

// SessionBase implements the Session methods whose behaviour is identical across drivers:
// lifecycle, read-only gating, schema defaulting, statement execution, table browsing, and row
// mutations. Driver sessions embed it and keep only catalog discovery (ListSchemas / ListTables /
// ListColumns), InsertRow, and ConnectionInfo driver-specific.
type SessionBase struct {
	DB            *sql.DB
	Driver        DriverType
	DefaultSchema string
	Host          string
	// ReadOnly re-checks statements at the session layer as defense-in-depth against future code
	// paths that bypass the app-layer gate.
	ReadOnly bool

	// SetupConn prepares every dedicated connection before use (e.g. SET search_path); nil when
	// the driver needs none.
	SetupConn func(ctx context.Context, conn *sql.Conn) error
	// RegisterKill wires a server-side cancel for the query about to run on conn; nil when the
	// driver has no kill mechanism.
	RegisterKill func(ctx context.Context, conn *sql.Conn) error
	// ListCols is the embedding session's ListColumns, needed here for primary-key discovery.
	ListCols func(ctx context.Context, schema, table string) ([]ColumnInfo, error)
}

func (b *SessionBase) DriverType() DriverType { return b.Driver }

func (b *SessionBase) Close() error { return b.DB.Close() }

func (b *SessionBase) Ping(ctx context.Context) error { return b.DB.PingContext(ctx) }

// SchemaOr returns schema, falling back to the session's default when empty.
func (b *SessionBase) SchemaOr(schema string) string {
	if schema == "" {
		return b.DefaultSchema
	}
	return schema
}

func (b *SessionBase) BeginTxn(ctx context.Context) (PinnedTxn, error) {
	return newPinnedTxn(ctx, b.DB, b.Driver, b.SetupConn)
}

func (b *SessionBase) PinnedConn(ctx context.Context) (PinnedConn, error) {
	return newPinnedConn(ctx, b.DB, b.Driver, b.SetupConn)
}

func (b *SessionBase) Execute(ctx context.Context, sqlText string) (*QueryResult, error) {
	return collectStream(func(opts StreamOpts) (*QueryResult, error) {
		return b.ExecuteStream(ctx, sqlText, opts)
	})
}

func (b *SessionBase) ExecuteStream(ctx context.Context, sqlText string, opts StreamOpts) (*QueryResult, error) {
	if b.ReadOnly {
		if err := AssertReadOnlySQLFor(b.Driver, sqlText); err != nil {
			return nil, err
		}
	}
	conn, err := b.DB.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if err := b.prepareConn(ctx, conn); err != nil {
		return nil, err
	}
	return runStatement(ctx, conn, b.Driver, sqlText, opts)
}

// prepareConn applies the driver's per-connection setup and kill registration to a freshly
// checked-out conn.
func (b *SessionBase) prepareConn(ctx context.Context, conn *sql.Conn) error {
	if b.SetupConn != nil {
		if err := b.SetupConn(ctx, conn); err != nil {
			return err
		}
	}
	if b.RegisterKill != nil {
		if err := b.RegisterKill(ctx, conn); err != nil {
			return err
		}
	}
	return nil
}

func (b *SessionBase) QueryTable(ctx context.Context, req TableDataRequest) (*QueryResult, error) {
	return collectStream(func(opts StreamOpts) (*QueryResult, error) {
		return b.QueryTableStream(ctx, req, opts)
	})
}

func (b *SessionBase) QueryTableStream(ctx context.Context, req TableDataRequest, opts StreamOpts) (*QueryResult, error) {
	// ValidateTableFilter enforces read-only-by-construction even on writable connections; run unconditionally.
	if err := ValidateTableFilter(req.Filter); err != nil {
		return nil, err
	}
	schema := b.SchemaOr(req.Schema)
	cols, err := b.ListCols(ctx, schema, req.Table)
	if err != nil {
		return nil, err
	}
	pks := PrimaryKeys(cols)
	query := buildTableSelectSQL(b.Driver, schema, req, cols, pks)

	start := NowMs()
	conn, err := b.DB.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if err := b.prepareConn(ctx, conn); err != nil {
		return nil, err
	}
	result := &QueryResult{PrimaryKeys: pks, TableName: req.Table, SchemaName: schema}
	return streamQueryRows(ctx, conn, query, start, opts, result)
}

func (b *SessionBase) UpdateRow(ctx context.Context, upd RowUpdate) error {
	if b.ReadOnly {
		return ErrReadOnly
	}
	schema := b.SchemaOr(upd.Schema)
	cols, err := b.ListCols(ctx, schema, upd.Table)
	if err != nil {
		return err
	}
	return applyRowUpdate(ctx, b.DB.ExecContext, b.Driver, schema, upd, cols)
}

func (b *SessionBase) DeleteRows(ctx context.Context, del RowDelete) (int64, error) {
	if b.ReadOnly {
		return 0, ErrReadOnly
	}
	schema := b.SchemaOr(del.Schema)
	cols, err := b.ListCols(ctx, schema, del.Table)
	if err != nil {
		return 0, err
	}
	return applyRowDeletes(ctx, b.DB.ExecContext, b.Driver, schema, del, cols)
}

// PingOrClose verifies db is reachable, closing it on failure so callers can't leak a dead pool.
// A positive timeout makes an unreachable host fail fast instead of hanging on the OS TCP timeout.
func PingOrClose(ctx context.Context, db *sql.DB, timeout time.Duration) error {
	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return err
	}
	return nil
}
