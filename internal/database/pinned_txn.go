package database

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
)

// PinnedConn is a dedicated connection for running a sequence of statements on one session, so
// session state (temp tables, SET, search_path) and multi-statement scripts behave. Call Close when
// done to release it back to the pool.
type PinnedConn interface {
	ExecuteStream(ctx context.Context, sql string, opts StreamOpts) (*QueryResult, error)
	// ExecuteScript runs each statement in order on this connection, streaming every result set
	// (including extra sets from a stored procedure) to sink. It stops at the first error.
	ExecuteScript(ctx context.Context, statements []string, sink ScriptSink) error
	Close()
}

// PinnedTxn is a PinnedConn with an open transaction. Call Commit or Rollback exactly once, then Close.
type PinnedTxn interface {
	PinnedConn
	Commit(ctx context.Context) error
	Rollback(ctx context.Context) error
}

type sqlPinnedConn struct {
	// mu serializes access to conn: a streaming query holds it for the whole stream, so Close (and,
	// for transactions, Commit/Rollback) waits for any in-flight statement to finish or be cancelled
	// before touching the connection - a *sql.Conn is not safe for concurrent use.
	mu     sync.Mutex
	conn   *sql.Conn
	driver DriverType
	done   bool // set once finalized (close/commit/rollback); guards against using a spent connection
}

// NewPinnedConn checks out a dedicated connection from db and runs optional setup (e.g. SET
// search_path). The caller must Close it.
func NewPinnedConn(ctx context.Context, db *sql.DB, driver DriverType, setup func(context.Context, *sql.Conn) error) (PinnedConn, error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	if setup != nil {
		if err := setup(ctx, conn); err != nil {
			_ = conn.Close()
			return nil, err
		}
	}
	return &sqlPinnedConn{conn: conn, driver: driver}, nil
}

func (t *sqlPinnedConn) ExecuteStream(ctx context.Context, sqlText string, opts StreamOpts) (*QueryResult, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.done {
		return nil, fmt.Errorf("connection is no longer active")
	}
	return RunStatement(ctx, t.conn, t.driver, sqlText, opts)
}

func (t *sqlPinnedConn) ExecuteScript(ctx context.Context, statements []string, sink ScriptSink) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.done {
		return fmt.Errorf("connection is no longer active")
	}
	return RunScript(ctx, t.conn, t.driver, statements, sink)
}

func (t *sqlPinnedConn) Close() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.done = true
	_ = t.conn.Close()
}

type sqlPinnedTxn struct {
	*sqlPinnedConn
}

// NewPinnedTxn checks out a dedicated connection, runs optional setup, then issues BEGIN. The caller
// must call Commit or Rollback, then Close.
func NewPinnedTxn(ctx context.Context, db *sql.DB, driver DriverType, setup func(context.Context, *sql.Conn) error) (PinnedTxn, error) {
	pc, err := NewPinnedConn(ctx, db, driver, setup)
	if err != nil {
		return nil, err
	}
	conn := pc.(*sqlPinnedConn)
	if _, err := conn.conn.ExecContext(ctx, "BEGIN"); err != nil {
		conn.Close()
		return nil, err
	}
	return &sqlPinnedTxn{sqlPinnedConn: conn}, nil
}

func (t *sqlPinnedTxn) Commit(ctx context.Context) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.done {
		return nil
	}
	t.done = true
	_, err := t.conn.ExecContext(ctx, "COMMIT")
	return err
}

func (t *sqlPinnedTxn) Rollback(ctx context.Context) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.done {
		return nil
	}
	t.done = true
	_, err := t.conn.ExecContext(ctx, "ROLLBACK")
	return err
}
