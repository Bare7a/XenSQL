// Package turso connects to Turso databases through turso.tech/database/tursogo. Turso is
// SQLite-compatible, so dialect, catalog and row editing all reuse the SQLite-family paths; only
// opening the engine and the optional Turso Cloud replica are specific to it.
package turso

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"

	tursogo "turso.tech/database/tursogo"

	"xensql/internal/database"
)

func init() {
	database.Register(&Driver{})
}

const syncTimeout = 30 * time.Second

type Driver struct{}

func (d *Driver) Type() database.DriverType { return database.DriverTurso }

func (d *Driver) TestConnection(ctx context.Context, cfg database.ConnectionConfig) error {
	return database.ConnectAndPing(ctx, d, cfg)
}

func (d *Driver) Connect(ctx context.Context, cfg database.ConnectionConfig) (database.Session, error) {
	database.NormalizeConnectionConfig(&cfg)
	if err := database.ValidateConnectionConfig(cfg); err != nil {
		return nil, err
	}
	return connect(ctx, cfg)
}

// connect is split out so the recover covers every use of the engine: tursogo loads a bundled native
// library on first use and panics instead of erroring when it can't (e.g. unwritable cache dir).
func connect(ctx context.Context, cfg database.ConnectionConfig) (sess database.Session, err error) {
	s := &Session{remoteHost: remoteHost(cfg.RemoteURL)}
	var db *sql.DB
	defer func() {
		if r := recover(); r != nil {
			if db != nil {
				_ = db.Close()
			}
			sess, err = nil, fmt.Errorf("turso: could not load the Turso engine: %v", r)
		}
	}()

	db, err = openDB(ctx, cfg, s)
	if err != nil {
		return nil, err
	}
	// One connection, kept for the session's life: the PRAGMAs below are per-connection state.
	db.SetMaxOpenConns(1)
	db.SetConnMaxIdleTime(0)
	db.SetConnMaxLifetime(0)

	s.SessionBase = database.SessionBase{
		DB:            db,
		Driver:        database.DriverTurso,
		DefaultSchema: "main",
		Host:          s.remoteHost,
		ReadOnly:      cfg.ReadOnly,
		SetupConn:     s.setupConn,
		ListCols:      s.ListColumns,
	}
	if err := database.PingOrClose(ctx, db, 0); err != nil {
		return nil, err
	}
	if err := s.pullOnConnect(ctx); err != nil {
		_ = s.Close()
		return nil, err
	}
	return s, nil
}

func openDB(ctx context.Context, cfg database.ConnectionConfig, s *Session) (*sql.DB, error) {
	if cfg.RemoteURL == "" {
		connector, err := tursogo.NewConnector(buildTursoDSN(cfg))
		if err != nil {
			return nil, err
		}
		return sql.OpenDB(&pragmaConnector{base: connector, pragmas: sessionPragmas(cfg)}), nil
	}

	// NewTursoSyncDb does the bootstrap round-trip, so a bad URL or token fails here, not on first query.
	bootstrapCtx, cancel := context.WithTimeout(ctx, syncTimeout)
	defer cancel()
	syncDB, err := tursogo.NewTursoSyncDb(bootstrapCtx, tursogo.TursoSyncDbConfig{
		Path:                 localPath(cfg.FilePath),
		RemoteUrl:            cfg.RemoteURL,
		AuthToken:            cfg.AuthToken,
		ExperimentalFeatures: cfg.ExperimentalFeatures,
		LongPollTimeoutMs:    0, // Pull runs inline on connect, so it must answer promptly.
	})
	if err != nil {
		return nil, fmt.Errorf("turso: connecting to %s failed: %w", remoteHost(cfg.RemoteURL), err)
	}
	// The sync engine owns its connector, so it can't be wrapped; these connections get their
	// PRAGMAs from SetupConn instead.
	db, err := syncDB.Connect(ctx)
	if err != nil {
		return nil, err
	}
	s.sync = syncDB
	return db, nil
}

// localPath drops any `?` query: tursogo reads it as DSN options (vfs, encryption key, busy
// timeout), so a database path must not be able to carry them. Mirrors sqlite's buildSQLiteDSN.
func localPath(filePath string) string {
	if i := strings.IndexByte(filePath, '?'); i >= 0 {
		return filePath[:i]
	}
	return filePath
}

// buildTursoDSN passes the feature list as one escaped value so it can't inject a second option.
// It can't come from the path instead: the sync-mode DSN parser reads only _busy_timeout, so a path
// query would silently stop working once a remote URL is set.
func buildTursoDSN(cfg database.ConnectionConfig) string {
	dsn := localPath(cfg.FilePath)
	if cfg.ExperimentalFeatures != "" {
		dsn += "?experimental=" + url.QueryEscape(cfg.ExperimentalFeatures)
	}
	return dsn
}

// Turso defaults foreign_keys to OFF where the sqlite driver's DSN turns it on; query_only makes the
// engine itself refuse writes, not just the SQL classifier.
func sessionPragmas(cfg database.ConnectionConfig) []string {
	pragmas := []string{"PRAGMA foreign_keys = ON"}
	if cfg.ReadOnly {
		pragmas = append(pragmas, "PRAGMA query_only = true")
	}
	return pragmas
}

// pragmaConnector applies the PRAGMAs to every physical connection, including those taken straight
// from *sql.DB by row edits and catalog reads, which never pass through SetupConn.
type pragmaConnector struct {
	base    driver.Connector
	pragmas []string
}

func (c *pragmaConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.base.Connect(ctx)
	if err != nil {
		return nil, err
	}
	execer, ok := conn.(driver.ExecerContext)
	if !ok {
		_ = conn.Close()
		return nil, fmt.Errorf("turso: driver connection cannot execute statements")
	}
	for _, p := range c.pragmas {
		if _, err := execer.ExecContext(ctx, p, nil); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("turso: %s: %w", p, err)
		}
	}
	return conn, nil
}

func (c *pragmaConnector) Driver() driver.Driver { return c.base.Driver() }

func remoteHost(remote string) string {
	if remote == "" {
		return ""
	}
	if u, err := url.Parse(remote); err == nil && u.Host != "" {
		return u.Host
	}
	return remote
}

type Session struct {
	database.SessionBase

	// sync is nil for a local-only database; tursogo exposes no teardown for it, so Close only
	// releases the pool.
	sync       *tursogo.TursoSyncDb
	remoteHost string
}

// setupConn is the only place synced connections get the PRAGMAs; local ones already have them.
func (s *Session) setupConn(ctx context.Context, conn *sql.Conn) error {
	for _, p := range sessionPragmas(database.ConnectionConfig{ReadOnly: s.ReadOnly}) {
		if _, err := conn.ExecContext(ctx, p); err != nil {
			return fmt.Errorf("turso: %s: %w", p, err)
		}
	}
	return nil
}

func (s *Session) ConnectionInfo(ctx context.Context) (database.ConnectionStatus, error) {
	return database.ConnectionStatus{
		Connected: true,
		Database:  "main",
		Schema:    "main",
		Host:      s.remoteHost,
	}, nil
}

func (s *Session) ListSchemas(ctx context.Context) ([]database.SchemaInfo, error) {
	return []database.SchemaInfo{{Name: "main"}}, nil
}

func (s *Session) ListTables(ctx context.Context, schema string) ([]database.TableInfo, error) {
	tables, err := database.SQLiteListTables(ctx, s.DB)
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(tables, func(t database.TableInfo) bool {
		return isTursoInternalTable(t.Name)
	}), nil
}

// Turso keeps bookkeeping in the ordinary catalog rather than under SQLite's reserved `sqlite_`
// prefix: turso_cdc* from change data capture (which sync runs on), __turso_internal_* from
// materialized views.
func isTursoInternalTable(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasPrefix(lower, "__turso_internal") ||
		lower == "turso_cdc" ||
		strings.HasPrefix(lower, "turso_cdc_")
}

func (s *Session) ListColumns(ctx context.Context, schema, table string) ([]database.ColumnInfo, error) {
	return database.SQLiteListColumns(ctx, s.DB, database.DriverTurso, table)
}

// The write paths below wrap SessionBase so a synced replica pushes once the write lands. Embedding
// has no virtual dispatch, so Execute needs wrapping alongside ExecuteStream.

func (s *Session) Execute(ctx context.Context, sqlText string) (*database.QueryResult, error) {
	res, err := s.SessionBase.Execute(ctx, sqlText)
	if err != nil {
		return res, err
	}
	return res, s.pushAfterWrite(ctx, sqlText)
}

func (s *Session) ExecuteStream(ctx context.Context, sqlText string, opts database.StreamOpts) (*database.QueryResult, error) {
	res, err := s.SessionBase.ExecuteStream(ctx, sqlText, opts)
	if err != nil {
		return res, err
	}
	return res, s.pushAfterWrite(ctx, sqlText)
}

func (s *Session) UpdateRow(ctx context.Context, upd database.RowUpdate) error {
	if err := s.SessionBase.UpdateRow(ctx, upd); err != nil {
		return err
	}
	return s.push(ctx)
}

func (s *Session) DeleteRows(ctx context.Context, del database.RowDelete) (int64, error) {
	n, err := s.SessionBase.DeleteRows(ctx, del)
	if err != nil {
		return n, err
	}
	return n, s.push(ctx)
}

func (s *Session) InsertRow(ctx context.Context, schema, table string, values map[string]any) (map[string]any, error) {
	if s.ReadOnly {
		return nil, database.ErrReadOnly
	}
	row, err := database.SQLiteInsertRow(ctx, s.DB, database.DriverTurso, schema, table, values)
	if err != nil {
		return nil, err
	}
	return row, s.push(ctx)
}

func (s *Session) PinnedConn(ctx context.Context) (database.PinnedConn, error) {
	pc, err := s.SessionBase.PinnedConn(ctx)
	if err != nil || s.sync == nil {
		return pc, err
	}
	return &syncPinnedConn{PinnedConn: pc, session: s}, nil
}

func (s *Session) BeginTxn(ctx context.Context) (database.PinnedTxn, error) {
	txn, err := s.SessionBase.BeginTxn(ctx)
	if err != nil || s.sync == nil {
		return txn, err
	}
	return &syncPinnedTxn{PinnedTxn: txn, session: s}, nil
}

// pullOnConnect fails the connect rather than quietly serving stale local rows for what the user
// opened as a cloud database.
func (s *Session) pullOnConnect(ctx context.Context) error {
	if s.sync == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, syncTimeout)
	defer cancel()
	if _, err := s.sync.Pull(ctx); err != nil {
		return fmt.Errorf("turso: opened the local replica but pulling from %s failed: %w", s.remoteHost, err)
	}
	return nil
}

// pushAfterWrite skips reads so browsing costs no round-trips, reusing the read-only classifier
// (which errs towards calling a statement a write).
func (s *Session) pushAfterWrite(ctx context.Context, sqlText string) error {
	if s.sync == nil {
		return nil
	}
	if database.AssertReadOnlySQLFor(database.DriverTurso, sqlText) == nil {
		return nil
	}
	return s.push(ctx)
}

func (s *Session) push(ctx context.Context) error {
	if s.sync == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, syncTimeout)
	defer cancel()
	if err := s.sync.Push(ctx); err != nil {
		return fmt.Errorf("turso: the write was applied locally but pushing it to %s failed: %w", s.remoteHost, err)
	}
	return nil
}

// syncPinnedConn pushes after statements and scripts, which run in autocommit.
type syncPinnedConn struct {
	database.PinnedConn
	session *Session
}

func (c *syncPinnedConn) ExecuteStream(ctx context.Context, sqlText string, opts database.StreamOpts) (*database.QueryResult, error) {
	res, err := c.PinnedConn.ExecuteStream(ctx, sqlText, opts)
	if err != nil {
		return res, err
	}
	return res, c.session.pushAfterWrite(ctx, sqlText)
}

func (c *syncPinnedConn) ExecuteScript(ctx context.Context, statements []string, sink database.ScriptSink) error {
	if err := c.PinnedConn.ExecuteScript(ctx, statements, sink); err != nil {
		return err
	}
	return c.session.push(ctx)
}

// syncPinnedTxn pushes on commit only: mid-transaction writes aren't durable, and a rollback leaves
// nothing to send.
type syncPinnedTxn struct {
	database.PinnedTxn
	session *Session
}

func (t *syncPinnedTxn) Commit(ctx context.Context) error {
	if err := t.PinnedTxn.Commit(ctx); err != nil {
		return err
	}
	return t.session.push(ctx)
}
