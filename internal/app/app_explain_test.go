package app

import (
	"strings"
	"testing"

	"xensql/internal/database"
)

func explainTestConn(t *testing.T, readOnly bool) (*App, string) {
	t.Helper()
	a := appForTest(t)
	cfg := sqliteConn(t)
	saved, err := a.SaveConnection(cfg)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	for _, stmt := range []string{
		"CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, age INTEGER)",
		"CREATE INDEX users_email ON users (email)",
		"INSERT INTO users (email, age) VALUES ('a@example.com', 30), ('b@example.com', 41)",
	} {
		if _, err := a.ExecuteQuery(saved.ID, stmt); err != nil {
			t.Fatalf("setup %q: %v", stmt, err)
		}
	}
	if readOnly {
		cfg = saved
		cfg.ReadOnly = true
		if _, err := a.SaveConnection(cfg); err != nil {
			t.Fatalf("mark read-only: %v", err)
		}
		a.Disconnect(saved.ID)
	}
	return a, saved.ID
}

func TestExplainQuerySQLite(t *testing.T) {
	a, connID := explainTestConn(t, false)

	plan, err := a.ExplainQuery(connID, "", "SELECT * FROM users WHERE email = 'a@example.com'", false)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	if plan.Driver != database.DriverSQLite {
		t.Errorf("driver = %q", plan.Driver)
	}
	if plan.Analyzed {
		t.Error("plan-only run must not report itself as analyzed")
	}
	if plan.ExplainSQL != "EXPLAIN QUERY PLAN SELECT * FROM users WHERE email = 'a@example.com'" {
		t.Errorf("explain sql = %q", plan.ExplainSQL)
	}
	if len(plan.Nodes) == 0 {
		t.Fatal("expected at least one plan node")
	}
	root := plan.Nodes[0]
	if root.Label != "SEARCH" || root.Relation != "users" || root.Index != "users_email" {
		t.Errorf("root = %+v, expected a SEARCH of users using users_email", root)
	}
	if plan.Raw == "" {
		t.Error("expected the engine's raw output to be kept")
	}
}

func TestExplainQuerySQLiteFullScan(t *testing.T) {
	a, connID := explainTestConn(t, false)

	plan, err := a.ExplainQuery(connID, "", "SELECT * FROM users WHERE age > 20", false)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	if root := plan.Nodes[0]; root.Label != "SCAN" || root.Relation != "users" {
		t.Errorf("root = %+v, expected a SCAN of users", root)
	}
}

func TestExplainQueryAnalyzeUnsupportedOnSQLite(t *testing.T) {
	a, connID := explainTestConn(t, false)

	_, err := a.ExplainQuery(connID, "", "SELECT * FROM users", true)
	if err == nil {
		t.Fatal("expected an error: SQLite has no EXPLAIN ANALYZE")
	}
	if !strings.Contains(err.Error(), "EXPLAIN ANALYZE") {
		t.Errorf("error should name the missing feature, got %v", err)
	}
}

func TestExplainQueryRejectsMultipleStatements(t *testing.T) {
	a, connID := explainTestConn(t, false)

	if _, err := a.ExplainQuery(connID, "", "SELECT 1; SELECT 2", false); err == nil {
		t.Fatal("expected an error for more than one statement")
	}
	if _, err := a.ExplainQuery(connID, "", "   ", false); err == nil {
		t.Fatal("expected an error for an empty statement")
	}
}

// A read-only connection blocks planning a write, as it blocks running one.
func TestExplainQueryReadOnlyBlocksWrites(t *testing.T) {
	a, connID := explainTestConn(t, true)

	if _, err := a.ExplainQuery(connID, "", "DELETE FROM users", false); err == nil {
		t.Fatal("expected a read-only error")
	}
	if _, err := a.ExplainQuery(connID, "", "SELECT * FROM users", false); err != nil {
		t.Fatalf("planning a read on a read-only connection should work: %v", err)
	}
}

func TestExplainQuerySkipsHistory(t *testing.T) {
	a, connID := explainTestConn(t, false)
	if err := a.ClearQueryHistory(connID); err != nil {
		t.Fatalf("clear history: %v", err)
	}

	if _, err := a.ExplainQuery(connID, "", "SELECT * FROM users", false); err != nil {
		t.Fatalf("explain: %v", err)
	}
	if entries := a.GetQueryHistory(connID, 10); len(entries) != 0 {
		t.Errorf("expected no history entries, got %v", entries)
	}
}

func TestExplainQueryUnknownConnection(t *testing.T) {
	a := appForTest(t)
	if _, err := a.ExplainQuery("nope", "", "SELECT 1", false); err == nil {
		t.Fatal("expected an error for an unknown connection")
	}
}
