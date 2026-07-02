package app

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"

	"xensql/internal/database"
)

// queryContext registers the query (cancelling any prior one on the connection) and returns the
// ordered stream id alongside the context. Streaming callers tag their emitted events with the id;
// non-streaming callers ignore it.
func (a *App) queryContext(connectionID string) (string, context.Context, func()) {
	streamID, ctx, end := a.queries.Start(connectionID, a.ctx)
	ctx = database.WithConnectionID(ctx, connectionID)
	ctx = database.WithQueryRegistry(ctx, a.queries)
	return streamID, ctx, end
}

func queryErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return fmt.Errorf("query cancelled: %w", err)
	}
	return err
}

// ResultIndex lets one run (StreamID) carry several result sets. Seq is a monotonic, contiguous
// per-stream counter (meta=0, then each rows/result/done) the frontend uses to reorder events that
// server mode's WebSocket can deliver out of order (desktop is ordered). See useQueryStreamEvents.ts.
type QueryStreamMetaEvent struct {
	Seq          int      `json:"seq"`
	TabID        string   `json:"tabId"`
	StreamID     string   `json:"streamId"`
	ConnectionID string   `json:"connectionId"`
	ResultIndex  int      `json:"resultIndex"`
	Columns      []string `json:"columns"`
	ColumnTypes  []string `json:"columnTypes"`
	SchemaName   string   `json:"schemaName,omitempty"`
	TableName    string   `json:"tableName,omitempty"`
}

type QueryStreamRowsEvent struct {
	Seq         int             `json:"seq"`
	TabID       string          `json:"tabId"`
	StreamID    string          `json:"streamId"`
	ResultIndex int             `json:"resultIndex"`
	Rows        [][]interface{} `json:"rows"`
}

// QueryStreamResultEvent finalizes one result set within a run. Result carries metadata only; rows
// were delivered via stream batches. Statement is the SQL that produced it (for labeling).
type QueryStreamResultEvent struct {
	Seq          int                   `json:"seq"`
	TabID        string                `json:"tabId"`
	StreamID     string                `json:"streamId"`
	ConnectionID string                `json:"connectionId"`
	ResultIndex  int                   `json:"resultIndex"`
	Result       *database.QueryResult `json:"result,omitempty"`
	Statement    string                `json:"statement,omitempty"`
	Error        string                `json:"error,omitempty"`
	ErrorInfo    *database.QueryError  `json:"errorInfo,omitempty"`
}

// QueryStreamDoneEvent terminates a run. ResultCount is how many result sets were emitted; Error is
// a batch-level failure (e.g. a connection couldn't be acquired) - per-statement errors arrive on
// the result event instead.
type QueryStreamDoneEvent struct {
	Seq          int                  `json:"seq"`
	TabID        string               `json:"tabId"`
	StreamID     string               `json:"streamId"`
	ConnectionID string               `json:"connectionId"`
	ResultCount  int                  `json:"resultCount"`
	Error        string               `json:"error,omitempty"`
	ErrorInfo    *database.QueryError `json:"errorInfo,omitempty"`
}

const queryStreamBatchSize = 5000

func (a *App) emitStreamMeta(tabID, streamID, connectionID string, resultIndex int, columns, columnTypes []string, schemaName, tableName string) {
	a.emit("query:stream:meta", QueryStreamMetaEvent{
		Seq:          a.nextStreamSeq(streamID),
		TabID:        tabID,
		StreamID:     streamID,
		ConnectionID: connectionID,
		ResultIndex:  resultIndex,
		Columns:      columns,
		ColumnTypes:  columnTypes,
		SchemaName:   schemaName,
		TableName:    tableName,
	})
}

func (a *App) emitStreamRows(tabID, streamID string, resultIndex int, rows [][]interface{}) {
	a.emit("query:stream:rows", QueryStreamRowsEvent{
		Seq:         a.nextStreamSeq(streamID),
		TabID:       tabID,
		StreamID:    streamID,
		ResultIndex: resultIndex,
		Rows:        rows,
	})
}

func (a *App) emitStreamResult(tabID, streamID, connectionID string, resultIndex int, result *database.QueryResult, statement string, err error) {
	payload := QueryStreamResultEvent{
		Seq:          a.nextStreamSeq(streamID),
		TabID:        tabID,
		StreamID:     streamID,
		ConnectionID: connectionID,
		ResultIndex:  resultIndex,
		Result:       result,
		Statement:    statement,
	}
	if err != nil {
		payload.Error = err.Error()
		payload.ErrorInfo = database.ClassifyError(err)
	}
	a.emit("query:stream:result", payload)
}

func (a *App) emitStreamDone(tabID, streamID, connectionID string, resultCount int, err error) {
	payload := QueryStreamDoneEvent{
		Seq:          a.nextStreamSeq(streamID),
		TabID:        tabID,
		StreamID:     streamID,
		ConnectionID: connectionID,
		ResultCount:  resultCount,
	}
	if err != nil {
		payload.Error = err.Error()
		payload.ErrorInfo = database.ClassifyError(err)
	}
	a.emit("query:stream:done", payload)
}

func (a *App) ExecuteQuery(connectionID, sql string) (*database.QueryResult, error) {
	if err := a.guardExecute(connectionID, sql); err != nil {
		return nil, err
	}
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	_, queryCtx, end := a.queryContext(connectionID)
	defer end()
	result, err := s.Execute(queryCtx, sql)
	err = queryErr(err)
	a.recordHistory(connectionID, sql, result, err)
	return result, err
}

func (a *App) ExecuteQueryStream(connectionID, tabID, sql string) error {
	if tabID == "" {
		return fmt.Errorf("tab id is required")
	}
	if err := a.guardExecute(connectionID, sql); err != nil {
		return err
	}
	a.runBatchStream(tabID, connectionID, database.SplitStatements(sql))
	return nil
}

// runBatchStream runs every statement on a single connection, streaming each result set (including
// extra sets from a stored procedure) tagged with its index, then a terminal done. Statements run on
// the tab's open transaction if there is one, otherwise on a freshly pinned connection so session
// state and multi-statement scripts behave.
func (a *App) runBatchStream(tabID, connectionID string, statements []string) {
	a.streamRun(tabID, connectionID, func(streamID string, queryCtx context.Context) {
		exec, release, err := a.batchExecutor(tabID, connectionID, queryCtx)
		if err != nil {
			a.emitStreamDone(tabID, streamID, connectionID, 0, err)
			return
		}
		if release != nil {
			defer release()
		}

		resultCount := 0
		type histEntry struct {
			stmt    string
			summary *database.QueryResult
			err     error
		}
		var hist []histEntry
		sink := database.ScriptSink{
			BatchSize: queryStreamBatchSize,
			OnMeta: func(idx int, cols, types []string) {
				a.emitStreamMeta(tabID, streamID, connectionID, idx, cols, types, "", "")
			},
			OnBatch: func(idx int, rows [][]interface{}) error {
				a.emitStreamRows(tabID, streamID, idx, rows)
				return nil
			},
			OnResult: func(idx int, summary *database.QueryResult, statement string, err error) {
				resultCount = idx + 1
				err = queryErr(err)
				hist = append(hist, histEntry{statement, summary, err})
				a.emitStreamResult(tabID, streamID, connectionID, idx, summary, statement, err)
			},
		}
		// Per-statement errors are reported via the result event above, so the terminal done carries
		// no error; it only signals completion and the final result count.
		_ = exec.ExecuteScript(queryCtx, statements, sink)
		// Record history after the script so storage writes stay off the connection mutex.
		for _, h := range hist {
			a.recordHistory(connectionID, h.stmt, h.summary, h.err)
		}
		a.emitStreamDone(tabID, streamID, connectionID, resultCount, nil)
	})
}

// batchExecutor returns the connection to run a script on: the tab's open transaction (no release),
// or a freshly pinned connection (release closes it).
func (a *App) batchExecutor(tabID, connectionID string, ctx context.Context) (database.PinnedConn, func(), error) {
	if txn, ok := a.txns.Get(tabID); ok {
		return txn, nil, nil
	}
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, nil, err
	}
	pc, err := s.PinnedConn(ctx)
	if err != nil {
		return nil, nil, err
	}
	return pc, pc.Close, nil
}

func (a *App) guardExecute(connectionID, sql string) error {
	cfg, err := a.getConnection(connectionID)
	if err != nil {
		return err
	}
	if cfg.ReadOnly {
		return database.AssertReadOnlySQL(sql)
	}
	return nil
}

func (a *App) CancelQuery(connectionID string) bool {
	return a.queries.Cancel(connectionID)
}

func (a *App) QueryTable(connectionID string, req database.TableDataRequest) (*database.QueryResult, error) {
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	if req.Limit <= 0 {
		req.Limit = 100
	}
	_, queryCtx, end := a.queryContext(connectionID)
	defer end()
	result, err := s.QueryTable(queryCtx, req)
	return result, queryErr(err)
}

func (a *App) QueryTableStream(connectionID, tabID string, req database.TableDataRequest) error {
	if tabID == "" {
		return fmt.Errorf("tab id is required")
	}
	if req.Limit <= 0 {
		req.Limit = 100
	}
	a.streamRun(tabID, connectionID, func(streamID string, queryCtx context.Context) {
		s, err := a.sessionFor(connectionID)
		if err != nil {
			a.emitStreamDone(tabID, streamID, connectionID, 0, err)
			return
		}
		opts := database.StreamOpts{
			BatchSize: queryStreamBatchSize,
			OnMeta: func(cols, types []string) {
				a.emitStreamMeta(tabID, streamID, connectionID, 0, cols, types, req.Schema, req.Table)
			},
			OnBatch: func(batch [][]interface{}) error {
				a.emitStreamRows(tabID, streamID, 0, batch)
				return nil
			},
		}
		// A table browse is always a single result set (index 0).
		result, err := s.QueryTableStream(queryCtx, req, opts)
		a.emitStreamResult(tabID, streamID, connectionID, 0, result, "", queryErr(err))
		a.emitStreamDone(tabID, streamID, connectionID, 1, nil)
	})
	return nil
}

// streamRun registers a query (cancelling any prior one on the connection) and runs fn on a
// goroutine, recovering panics into a terminal done event. fn emits its own meta/rows/result events
// followed by a terminal done. Registering synchronously keeps cancel order and stream-id order
// matched: a query started later supersedes - and gets a higher id than - one started earlier, even
// if their goroutines are scheduled out of order.
func (a *App) streamRun(tabID, connectionID string, fn func(streamID string, queryCtx context.Context)) {
	streamID, queryCtx, end := a.queryContext(connectionID)
	go func() {
		defer end()
		// Drop the counter after this run's emits (LIFO: runs after the panic-path done below).
		defer a.streamSeqs.Delete(streamID)
		// Recover panics at the goroutine boundary; surface them as a terminal done error so the UI
		// shows them instead of the process crashing.
		defer func() {
			if r := recover(); r != nil {
				a.emitStreamDone(tabID, streamID, connectionID, 0, fmt.Errorf("query panicked: %v", r))
			}
		}()
		fn(streamID, queryCtx)
	}()
}

// nextStreamSeq returns the next 0-based per-StreamID sequence number. Emits within a run are
// sequential (one goroutine), so the counter stays contiguous.
func (a *App) nextStreamSeq(streamID string) int {
	v, _ := a.streamSeqs.LoadOrStore(streamID, &atomic.Uint64{})
	return int(v.(*atomic.Uint64).Add(1) - 1)
}

func (a *App) UpdateRow(connectionID string, upd database.RowUpdate) error {
	if err := a.assertWritableConnection(connectionID); err != nil {
		return err
	}
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return err
	}
	return s.UpdateRow(a.ctx, upd)
}

func (a *App) DeleteRows(connectionID string, del database.RowDelete) (int64, error) {
	if err := a.assertWritableConnection(connectionID); err != nil {
		return 0, err
	}
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return 0, err
	}
	return s.DeleteRows(a.ctx, del)
}

func (a *App) InsertRow(connectionID, schema, table string, values map[string]interface{}) (map[string]interface{}, error) {
	if err := a.assertWritableConnection(connectionID); err != nil {
		return nil, err
	}
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	return s.InsertRow(a.ctx, schema, table, values)
}
