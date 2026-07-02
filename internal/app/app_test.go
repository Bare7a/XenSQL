package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"xensql/internal/database"
	"xensql/internal/storage"
)

func TestIsSQLiteFile(t *testing.T) {
	tests := map[string]bool{
		"data.db":      true,
		"foo.sqlite":   true,
		"foo.sqlite3":  true,
		"foo.s3db":     true,
		"foo.sl3":      true,
		"FOO.SQLITE":   true, // case-insensitive
		"path/to/x.DB": true,
		"foo.txt":      false,
		"foo":          false,
		"sqlite":       false,
		"foo.sql":      false,
		"foo.db.bak":   false,
		"":             false,
	}
	for in, want := range tests {
		if got := isSQLiteFile(in); got != want {
			t.Errorf("isSQLiteFile(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestFindSQLiteArgPicksExistingFile(t *testing.T) {
	dir := t.TempDir()
	existing := filepath.Join(dir, "real.sqlite")
	if err := os.WriteFile(existing, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	args := []string{"--flag", "missing.db", existing, "ignored.txt"}
	if got := FindSQLiteArg(args); got != existing {
		t.Fatalf("expected %q, got %q", existing, got)
	}
}

func TestFindSQLiteArgIgnoresMissingFiles(t *testing.T) {
	if got := FindSQLiteArg([]string{"--flag", "missing.db"}); got != "" {
		t.Fatalf("expected empty for missing file, got %q", got)
	}
}

func TestFindSQLiteArgEmpty(t *testing.T) {
	if got := FindSQLiteArg(nil); got != "" {
		t.Fatalf("expected empty for nil args, got %q", got)
	}
}

func appForTest(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	a := NewApp()
	a.ctx = context.Background()
	var err error
	if a.store, err = storage.NewStore(dir); err != nil {
		t.Fatalf("storage: %v", err)
	}
	if a.history, err = storage.NewHistoryStore(dir); err != nil {
		t.Fatalf("history: %v", err)
	}
	if a.savedQueries, err = storage.NewSavedQueriesStore(dir); err != nil {
		t.Fatalf("savedQueries: %v", err)
	}
	if a.session, err = storage.NewSessionStore(dir); err != nil {
		t.Fatalf("session: %v", err)
	}
	return a
}

func sqliteConn(t *testing.T) database.ConnectionConfig {
	t.Helper()
	return database.ConnectionConfig{
		Name:     "test",
		Driver:   database.DriverSQLite,
		FilePath: filepath.Join(t.TempDir(), "test.db"),
	}
}

func TestAppConnectionCRUD(t *testing.T) {
	a := appForTest(t)

	saved, err := a.SaveConnection(sqliteConn(t))
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.ID == "" {
		t.Fatal("saved connection should have an ID")
	}

	list := a.ListConnections()
	if len(list) != 1 || list[0].ID != saved.ID {
		t.Fatalf("list: got %v", list)
	}

	if !a.DeleteConnection(saved.ID) {
		t.Fatal("delete returned false")
	}
	if len(a.ListConnections()) != 0 {
		t.Fatal("expected empty list after delete")
	}
}

func TestAppConnectAndDisconnect(t *testing.T) {
	a := appForTest(t)

	saved, err := a.SaveConnection(sqliteConn(t))
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := a.Connect(saved.ID); err != nil {
		t.Fatalf("connect: %v", err)
	}
	if !a.IsConnected(saved.ID) {
		t.Fatal("should be connected")
	}

	a.Disconnect(saved.ID)
	if a.IsConnected(saved.ID) {
		t.Fatal("should be disconnected after Disconnect")
	}
}

func TestAppExecuteQuery(t *testing.T) {
	a := appForTest(t)
	saved, err := a.SaveConnection(sqliteConn(t))
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	if _, err := a.ExecuteQuery(saved.ID, "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)"); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := a.ExecuteQuery(saved.ID, "INSERT INTO t VALUES (1, 'hello')"); err != nil {
		t.Fatalf("insert: %v", err)
	}

	result, err := a.ExecuteQuery(saved.ID, "SELECT * FROM t")
	if err != nil {
		t.Fatalf("select: %v", err)
	}
	if result.RowCount != 1 || result.Rows[0][1] != "hello" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestAppReadOnlyBlocksWrite(t *testing.T) {
	a := appForTest(t)

	cfg := sqliteConn(t)
	cfg.ReadOnly = true
	saved, err := a.SaveConnection(cfg)
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	if _, err := a.ExecuteQuery(saved.ID, "CREATE TABLE t (id INTEGER)"); err == nil {
		t.Fatal("expected error for DDL on read-only connection")
	}
	if _, err := a.ExecuteQuery(saved.ID, "SELECT 1"); err != nil {
		t.Fatalf("SELECT on read-only should succeed: %v", err)
	}
}

func TestAppQueryHistory(t *testing.T) {
	a := appForTest(t)
	saved, err := a.SaveConnection(sqliteConn(t))
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	if _, err := a.ExecuteQuery(saved.ID, "SELECT 42"); err != nil {
		t.Fatalf("query: %v", err)
	}

	entries := a.GetQueryHistory(saved.ID, 10)
	if len(entries) != 1 || entries[0].SQL != "SELECT 42" || !entries[0].Success {
		t.Fatalf("history: got %v", entries)
	}

	if err := a.ClearQueryHistory(saved.ID); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if len(a.GetQueryHistory(saved.ID, 10)) != 0 {
		t.Fatal("expected empty history after clear")
	}
}

func TestAppSavedQueries(t *testing.T) {
	a := appForTest(t)

	q := database.SavedQuery{Name: "get all", SQL: "SELECT * FROM users"}
	saved, err := a.SaveSavedQuery(q)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.ID == "" {
		t.Fatal("saved query should have an ID")
	}

	list := a.ListSavedQueries("")
	if len(list) != 1 || list[0].ID != saved.ID {
		t.Fatalf("list: got %v", list)
	}

	if !a.DeleteSavedQuery(saved.ID) {
		t.Fatal("delete returned false")
	}
	if len(a.ListSavedQueries("")) != 0 {
		t.Fatal("expected empty list after delete")
	}
}

func TestAppMutations(t *testing.T) {
	a := appForTest(t)
	saved, err := a.SaveConnection(sqliteConn(t))
	if err != nil {
		t.Fatalf("save: %v", err)
	}

	if _, err := a.ExecuteQuery(saved.ID, "CREATE TABLE things (id INTEGER PRIMARY KEY, label TEXT)"); err != nil {
		t.Fatalf("create: %v", err)
	}

	row, err := a.InsertRow(saved.ID, "main", "things", map[string]any{"id": int64(1), "label": "first"})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	// Full row returned: Postgres via RETURNING *, MySQL via int-PK reselect, SQLite via rowid lookup.
	if got := row["id"]; got != int64(1) {
		t.Fatalf("InsertRow id = %v, want 1; full row = %v", got, row)
	}
	if got := row["label"]; got != "first" {
		t.Fatalf("InsertRow label = %v, want first; full row = %v", got, row)
	}

	if err := a.UpdateRow(saved.ID, database.RowUpdate{
		Schema:     "main",
		Table:      "things",
		PrimaryKey: map[string]any{"id": int64(1)},
		Changes:    map[string]any{"label": "updated"},
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	n, err := a.DeleteRows(saved.ID, database.RowDelete{
		Schema:      "main",
		Table:       "things",
		PrimaryKeys: []map[string]any{{"id": int64(1)}},
	})
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 deleted, got %d", n)
	}
}
