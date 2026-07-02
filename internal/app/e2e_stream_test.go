//go:build e2e

package app

import (
	"fmt"
	"sync"
	"testing"

	"xensql/internal/database"
)

// The streaming App methods (ExecuteQueryStream / QueryTableStream) push rows to
// the UI via Wails runtime events, which require the real desktop runtime. These
// tests drive the exact engine those methods delegate to - Session.ExecuteStream,
// Session.QueryTableStream and PinnedConn.ExecuteScript - so the streaming,
// batching and multi-result-set behaviour is covered end-to-end against a real
// server, minus only the Wails event plumbing.

// streamCapture records the callbacks of a single-result stream (StreamOpts).
type streamCapture struct {
	mu      sync.Mutex
	cols    []string
	types   []string
	batches int
	rows    [][]any
}

func (c *streamCapture) opts(batchSize int) database.StreamOpts {
	return database.StreamOpts{
		BatchSize: batchSize,
		OnMeta: func(cols, types []string) {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.cols, c.types = cols, types
		},
		OnBatch: func(batch [][]any) error {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.batches++
			c.rows = append(c.rows, batch...)
			return nil
		},
	}
}

// TestE2EStreamBatching checks rows stream back in batches (not one giant slab)
// and that column metadata is delivered before the rows.
func TestE2EStreamBatching(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := uniqueTable("stream")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)
		const total = 12
		for i := 0; i < total; i++ {
			mustExec(t, a, connID, fmt.Sprintf("INSERT INTO %s (name) VALUES ('r%d')", qualified(e, table), i))
		}

		s, err := a.sessionFor(connID)
		if err != nil {
			t.Fatalf("session: %v", err)
		}
		cap := &streamCapture{}
		res, err := s.ExecuteStream(testCtx(),
			"SELECT id, name FROM "+qualified(e, table)+" ORDER BY id", cap.opts(5))
		if err != nil {
			t.Fatalf("ExecuteStream: %v", err)
		}
		if res.RowCount != total {
			t.Errorf("RowCount = %d, want %d", res.RowCount, total)
		}
		if len(cap.rows) != total {
			t.Errorf("streamed %d rows, want %d", len(cap.rows), total)
		}
		// 12 rows at batch size 5 -> 3 batches; the point is "more than one".
		if cap.batches < 2 {
			t.Errorf("expected multiple batches at batchSize=5, got %d", cap.batches)
		}
		if len(cap.cols) != 2 || cap.cols[1] != "name" {
			t.Errorf("OnMeta columns = %+v, want [id name]", cap.cols)
		}
		if len(cap.types) != 2 || cap.types[0] == "" {
			t.Errorf("OnMeta column types should be populated, got %+v", cap.types)
		}
	})
}

// TestE2EQueryTableStream checks the streaming table-browse path carries the same
// primary-key metadata as the buffered QueryTable.
func TestE2EQueryTableStream(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := uniqueTable("tstream")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)
		for i := 0; i < 7; i++ {
			mustExec(t, a, connID, fmt.Sprintf("INSERT INTO %s (name) VALUES ('n%d')", qualified(e, table), i))
		}

		s, err := a.sessionFor(connID)
		if err != nil {
			t.Fatalf("session: %v", err)
		}
		cap := &streamCapture{}
		res, err := s.QueryTableStream(testCtx(), database.TableDataRequest{
			Schema: e.browseSchema, Table: table, Limit: 100, OrderBy: "id", OrderDir: "ASC",
		}, cap.opts(3))
		if err != nil {
			t.Fatalf("QueryTableStream: %v", err)
		}
		if res.RowCount != 7 || len(cap.rows) != 7 {
			t.Errorf("streamed %d rows / RowCount %d, want 7", len(cap.rows), res.RowCount)
		}
		if len(res.PrimaryKeys) != 1 || res.PrimaryKeys[0] != "id" {
			t.Errorf("PrimaryKeys = %+v, want [id]", res.PrimaryKeys)
		}
	})
}

// scriptCapture records the per-result-set callbacks of a script run (ScriptSink).
type scriptCapture struct {
	mu      sync.Mutex
	metas   map[int][]string // resultIndex -> columns
	rows    map[int][][]any  // resultIndex -> rows
	results []scriptResult   // in OnResult order
}

type scriptResult struct {
	index int
	err   error
}

func newScriptCapture() *scriptCapture {
	return &scriptCapture{metas: map[int][]string{}, rows: map[int][][]any{}}
}

func (c *scriptCapture) sink(batchSize int) database.ScriptSink {
	return database.ScriptSink{
		BatchSize: batchSize,
		OnMeta: func(idx int, cols, _ []string) {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.metas[idx] = cols
		},
		OnBatch: func(idx int, rows [][]any) error {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.rows[idx] = append(c.rows[idx], rows...)
			return nil
		},
		OnResult: func(idx int, _ *database.QueryResult, _ string, err error) {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.results = append(c.results, scriptResult{idx, err})
		},
	}
}

// TestE2EMultiStatementScript checks a multi-statement script yields one result
// set per statement, in order - the "a result tab per statement" feature.
func TestE2EMultiStatementScript(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		s, err := a.sessionFor(connID)
		if err != nil {
			t.Fatalf("session: %v", err)
		}
		pc, err := s.PinnedConn(testCtx())
		if err != nil {
			t.Fatalf("PinnedConn: %v", err)
		}
		defer pc.Close()

		script := "SELECT 1 AS a; SELECT 'x' AS b, 'y' AS c"
		stmts := database.SplitStatements(script)
		if len(stmts) != 2 {
			t.Fatalf("SplitStatements gave %d statements, want 2: %+v", len(stmts), stmts)
		}

		cap := newScriptCapture()
		if err := pc.ExecuteScript(testCtx(), stmts, cap.sink(5000)); err != nil {
			t.Fatalf("ExecuteScript: %v", err)
		}
		if len(cap.results) != 2 {
			t.Fatalf("expected 2 result sets, got %d", len(cap.results))
		}
		for _, r := range cap.results {
			if r.err != nil {
				t.Fatalf("result %d errored: %v", r.index, r.err)
			}
		}
		if cols := cap.metas[0]; len(cols) != 1 || cols[0] != "a" {
			t.Errorf("result 0 columns = %+v, want [a]", cols)
		}
		if cols := cap.metas[1]; len(cols) != 2 || cols[0] != "b" || cols[1] != "c" {
			t.Errorf("result 1 columns = %+v, want [b c]", cols)
		}
	})
}

// TestE2EScriptStopsOnError checks a failing statement halts the script and the
// error is reported on that statement's result (later statements don't run).
func TestE2EScriptStopsOnError(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		s, err := a.sessionFor(connID)
		if err != nil {
			t.Fatalf("session: %v", err)
		}
		pc, err := s.PinnedConn(testCtx())
		if err != nil {
			t.Fatalf("PinnedConn: %v", err)
		}
		defer pc.Close()

		stmts := []string{"SELECT 1", "SELECT * FROM missing_table_zzz", "SELECT 2"}
		cap := newScriptCapture()
		if err := pc.ExecuteScript(testCtx(), stmts, cap.sink(5000)); err == nil {
			t.Fatal("ExecuteScript should return the failing statement's error")
		}
		// First statement succeeds, second fails, third never runs.
		if len(cap.results) != 2 {
			t.Fatalf("expected 2 results (ok, err) before stopping, got %d", len(cap.results))
		}
		if cap.results[0].err != nil {
			t.Errorf("first statement should succeed, got %v", cap.results[0].err)
		}
		if cap.results[1].err == nil {
			t.Error("second statement should report an error")
		}
	})
}
