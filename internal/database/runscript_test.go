package database

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func memConn(t *testing.T) (*sql.Conn, func()) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatalf("conn: %v", err)
	}
	return conn, func() {
		_ = conn.Close()
		_ = db.Close()
	}
}

type capturedSet struct {
	index   int
	cols    []string
	rows    [][]any
	summary *QueryResult
	stmt    string
	err     error
}

// captureSink records every result set the script emits, in order.
func captureSink(sets *[]*capturedSet) ScriptSink {
	byIndex := map[int]*capturedSet{}
	get := func(idx int) *capturedSet {
		s := byIndex[idx]
		if s == nil {
			s = &capturedSet{index: idx}
			byIndex[idx] = s
		}
		return s
	}
	return ScriptSink{
		OnMeta: func(idx int, cols, _ []string) { get(idx).cols = cols },
		OnBatch: func(idx int, rows [][]any) error {
			s := get(idx)
			s.rows = append(s.rows, rows...)
			return nil
		},
		OnResult: func(idx int, summary *QueryResult, stmt string, err error) {
			s := get(idx)
			s.summary = summary
			s.stmt = stmt
			s.err = err
			*sets = append(*sets, s)
		},
	}
}

func TestRunScriptMultipleStatements(t *testing.T) {
	conn, cleanup := memConn(t)
	defer cleanup()

	var sets []*capturedSet
	script := `
		CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
		INSERT INTO t (name) VALUES ('a'), ('b');
		SELECT id, name FROM t ORDER BY id;
		SELECT count(*) AS n FROM t;
	`
	stmts := SplitStatements(DriverSQLite, script)
	if len(stmts) != 4 {
		t.Fatalf("SplitStatements: want 4, got %d (%#v)", len(stmts), stmts)
	}
	if err := RunScript(context.Background(), conn, DriverSQLite, stmts, captureSink(&sets)); err != nil {
		t.Fatalf("RunScript: %v", err)
	}
	if len(sets) != 4 {
		t.Fatalf("want 4 result sets, got %d", len(sets))
	}
	for i, s := range sets {
		if s.index != i {
			t.Errorf("result set %d reported index %d", i, s.index)
		}
		if s.err != nil {
			t.Errorf("result set %d unexpected error: %v", i, s.err)
		}
	}
	if sets[1].summary == nil || sets[1].summary.AffectedRows != 2 {
		t.Errorf("INSERT affected rows: want 2, got %+v", sets[1].summary)
	}
	if len(sets[2].cols) != 2 || len(sets[2].rows) != 2 {
		t.Errorf("SELECT set: want 2 cols / 2 rows, got %d cols / %d rows", len(sets[2].cols), len(sets[2].rows))
	}
	if len(sets[3].rows) != 1 {
		t.Errorf("count set: want 1 row, got %d", len(sets[3].rows))
	}
}

func TestRunScriptStopsAtFirstError(t *testing.T) {
	conn, cleanup := memConn(t)
	defer cleanup()

	var sets []*capturedSet
	stmts := SplitStatements(DriverSQLite, "SELECT 1; SELECT bad syntax here; SELECT 2;")
	err := RunScript(context.Background(), conn, DriverSQLite, stmts, captureSink(&sets))
	if err == nil {
		t.Fatal("want RunScript to return the failing statement's error")
	}
	// First statement succeeds, second errors, third never runs.
	if len(sets) != 2 {
		t.Fatalf("want 2 result sets before stopping, got %d", len(sets))
	}
	if sets[0].err != nil {
		t.Errorf("first set should succeed, got %v", sets[0].err)
	}
	if sets[1].err == nil {
		t.Error("second set should carry the syntax error")
	}
}
