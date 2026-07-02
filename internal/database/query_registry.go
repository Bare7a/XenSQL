package database

import (
	"context"
	"database/sql"
	"strconv"
	"sync"
)

type QueryRegistry struct {
	mu   sync.Mutex
	seq  uint64
	byID map[string]*runningQuery
}

type runningQuery struct {
	cancel context.CancelFunc
	kill   func() // e.g. pg_cancel_backend; runs before context cancel
}

func NewQueryRegistry() *QueryRegistry {
	return &QueryRegistry{byID: make(map[string]*runningQuery)}
}

// Start cancels any in-flight query for connectionID and registers a fresh context, returning a
// monotonic stream id assigned under the same lock - so id order matches cancel order (the query that
// registers last both supersedes the earlier one and gets the higher id).
func (r *QueryRegistry) Start(connectionID string, parent context.Context) (string, context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)

	r.mu.Lock()
	if old, ok := r.byID[connectionID]; ok {
		if old.kill != nil {
			old.kill()
		}
		old.cancel()
	}
	r.seq++
	streamID := strconv.FormatUint(r.seq, 10)
	rq := &runningQuery{cancel: cancel}
	r.byID[connectionID] = rq
	r.mu.Unlock()

	end := func() {
		r.mu.Lock()
		if r.byID[connectionID] == rq {
			delete(r.byID, connectionID)
		}
		r.mu.Unlock()
		// Idempotent; skipping it leaks the child context for the app's lifetime.
		cancel()
	}
	return streamID, ctx, end
}

func (r *QueryRegistry) SetKill(connectionID string, kill func()) {
	r.mu.Lock()
	if rq, ok := r.byID[connectionID]; ok {
		rq.kill = kill
	}
	r.mu.Unlock()
}

// RegisterServerKill wires a server-side cancel for the query about to run on conn: it resolves the
// connection's server id via probeSQL (e.g. pg_backend_pid) and registers kill(id) with the query
// registry carried by ctx. A ctx without a connection id or registry is a no-op.
func RegisterServerKill(ctx context.Context, conn *sql.Conn, probeSQL string, kill func(serverID int64)) error {
	connID, ok := ConnectionIDFromContext(ctx)
	if !ok {
		return nil
	}
	reg := QueryRegistryFromContext(ctx)
	if reg == nil {
		return nil
	}
	var id int64
	if err := conn.QueryRowContext(ctx, probeSQL).Scan(&id); err != nil {
		return err
	}
	reg.SetKill(connID, func() { kill(id) })
	return nil
}

func (r *QueryRegistry) Cancel(connectionID string) bool {
	r.mu.Lock()
	rq, ok := r.byID[connectionID]
	if ok {
		delete(r.byID, connectionID)
	}
	r.mu.Unlock()
	if !ok {
		return false
	}
	if rq.kill != nil {
		rq.kill()
	}
	rq.cancel()
	return true
}

// Used at shutdown so goroutines unwind before connections close.
func (r *QueryRegistry) CancelAll() {
	r.mu.Lock()
	pending := r.byID
	r.byID = make(map[string]*runningQuery)
	r.mu.Unlock()
	for _, rq := range pending {
		if rq.kill != nil {
			rq.kill()
		}
		rq.cancel()
	}
}
