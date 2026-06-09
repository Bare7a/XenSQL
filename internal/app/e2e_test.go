//go:build e2e

package app

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"xensql/internal/database"
)

// testCtx returns a context with a generous timeout so a hung server fails the
// test instead of blocking the whole run.
func testCtx() context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	_ = cancel // tests are short-lived; the timeout is the safety net
	return ctx
}

var tableSeq atomic.Int64

// uniqueTable returns a fresh table name so parallel/repeated runs never collide
// and a leftover table from a crashed run can't poison a later one.
func uniqueTable(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano()%1_000_000, tableSeq.Add(1))
}

// forEachEngine runs fn once per engine, as a subtest named after the engine.
// Engines that aren't reachable are skipped (not failed), so a partial local
// stack still tests whatever is up; CI brings up all three.
func forEachEngine(t *testing.T, fn func(t *testing.T, a *App, e engine, connID string)) {
	t.Helper()
	for _, e := range allEngines() {
		e := e
		t.Run(e.name, func(t *testing.T) {
			a := appForTest(t)
			connID := requireEngine(t, a, e)
			fn(t, a, e, connID)
		})
	}
}

// mustExec runs a statement that is expected to succeed, failing the test otherwise.
func mustExec(t *testing.T, a *App, connID, sql string) {
	t.Helper()
	if _, err := a.ExecuteQuery(connID, sql); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

// createTempTable creates a table and registers a DROP cleanup so the shared
// test database is left clean even when an assertion fails mid-test.
func createTempTable(t *testing.T, a *App, e engine, connID, ddl, table string) {
	t.Helper()
	mustExec(t, a, connID, ddl)
	t.Cleanup(func() {
		// Best-effort: a failed connection during teardown shouldn't mask the real failure.
		_, _ = a.ExecuteQuery(connID, "DROP TABLE IF EXISTS "+qualified(e, table))
	})
}

// qualified quotes schema.table (or just table for the default schema) for the engine.
func qualified(e engine, table string) string {
	return database.BuildQualifiedTable(e.driver, e.browseSchema, table)
}

// TestE2EConnectivity is the smoke test: it proves the suite can reach each
// configured engine. Run it alone to debug the stack:
//
//	go test -tags e2e -run TestE2EConnectivity -v
func TestE2EConnectivity(t *testing.T) {
	for _, e := range allEngines() {
		e := e
		t.Run(e.name, func(t *testing.T) {
			if err := reachable(e); err != nil {
				t.Skipf("%s not reachable (%v) - bring the stack up with `make e2e-up`", e.name, err)
			}
			a := appForTest(t)
			id := requireEngine(t, a, e)

			status, err := a.GetConnectionStatus(id)
			if err != nil {
				t.Fatalf("[%s] connection status: %v", e.name, err)
			}
			if !status.Connected {
				t.Fatalf("[%s] expected Connected=true, got %+v", e.name, status)
			}
			t.Logf("[%s] connected: db=%q user=%q schema=%q", e.name, status.Database, status.User, status.Schema)
		})
	}
}
