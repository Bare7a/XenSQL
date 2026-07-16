package sqlite

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"xensql/internal/database"
)

func newTestSession(t *testing.T) database.Session {
	t.Helper()
	dir := t.TempDir()
	cfg := database.ConnectionConfig{
		ID:       "test",
		Driver:   database.DriverSQLite,
		FilePath: filepath.Join(dir, "test.db"),
	}
	d := &Driver{}
	s, err := d.Connect(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestConnectRequiresFilePath(t *testing.T) {
	if _, err := (&Driver{}).Connect(context.Background(), database.ConnectionConfig{Driver: database.DriverSQLite}); err == nil {
		t.Fatal("expected error when file path missing")
	}
}

func TestBuildSQLiteDSN(t *testing.T) {
	// Read-only enforced at the connection, not just via the SQL classifier.
	if dsn := buildSQLiteDSN(database.ConnectionConfig{FilePath: "/tmp/db.sqlite", ReadOnly: true}); !strings.Contains(dsn, "query_only(true)") {
		t.Errorf("read-only should add query_only pragma, got %q", dsn)
	}
	if dsn := buildSQLiteDSN(database.ConnectionConfig{FilePath: "/tmp/db.sqlite"}); strings.Contains(dsn, "query_only") {
		t.Errorf("writable connection should not set query_only, got %q", dsn)
	}
	// A query string smuggled into the path must be dropped (no PRAGMA / mode= injection).
	dsn := buildSQLiteDSN(database.ConnectionConfig{FilePath: "/tmp/db.sqlite?mode=ro&_pragma=journal_mode(MEMORY)"})
	if strings.Contains(dsn, "mode=ro") || strings.Contains(dsn, "journal_mode") {
		t.Errorf("injected path query should be stripped, got %q", dsn)
	}
}

func TestSessionPingAndSchemaInfo(t *testing.T) {
	s := newTestSession(t)
	ctx := context.Background()
	if err := s.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	schemas, err := s.ListSchemas(ctx)
	if err != nil || len(schemas) != 1 || schemas[0].Name != "main" {
		t.Fatalf("ListSchemas got %+v err=%v", schemas, err)
	}
	info, err := s.ConnectionInfo(ctx)
	if err != nil || info.Database != "main" {
		t.Fatalf("ConnectionInfo got %+v err=%v", info, err)
	}
}

func TestListColumnsMarksForeignKeys(t *testing.T) {
	s := newTestSession(t)
	ctx := context.Background()

	if _, err := s.Execute(ctx, `CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT)`); err != nil {
		t.Fatalf("create parent: %v", err)
	}
	if _, err := s.Execute(ctx, `CREATE TABLE books (
		id INTEGER PRIMARY KEY,
		title TEXT,
		author_id INTEGER REFERENCES authors(id)
	)`); err != nil {
		t.Fatalf("create child: %v", err)
	}

	cols, err := s.ListColumns(ctx, "main", "books")
	if err != nil {
		t.Fatalf("list cols: %v", err)
	}
	byName := make(map[string]database.ColumnInfo, len(cols))
	for _, c := range cols {
		byName[c.Name] = c
	}
	if fk, ok := byName["author_id"]; !ok || !fk.IsForeign {
		t.Fatalf("author_id should be marked foreign, got %+v", byName["author_id"])
	}
	if fk := byName["author_id"]; fk.ForeignTable != "authors" || fk.ForeignColumn != "id" {
		t.Errorf("author_id should reference authors(id), got %+v", fk)
	}
	if byName["author_id"].IsPrimary {
		t.Errorf("author_id should not be marked primary, got %+v", byName["author_id"])
	}
	if byName["id"].IsForeign {
		t.Errorf("id should not be marked foreign, got %+v", byName["id"])
	}
	if byName["title"].IsForeign {
		t.Errorf("title should not be marked foreign, got %+v", byName["title"])
	}
}

func TestSessionExecuteAndTableLifecycle(t *testing.T) {
	s := newTestSession(t)
	ctx := context.Background()

	if _, err := s.Execute(ctx, `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	tables, err := s.ListTables(ctx, "main")
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	if len(tables) != 1 || tables[0].Name != "users" {
		t.Fatalf("expected one table, got %+v", tables)
	}

	cols, err := s.ListColumns(ctx, "main", "users")
	if err != nil {
		t.Fatalf("list cols: %v", err)
	}
	if len(cols) != 3 {
		t.Fatalf("expected 3 columns, got %d", len(cols))
	}
	var idCol *database.ColumnInfo
	for i := range cols {
		if cols[i].Name == "id" {
			idCol = &cols[i]
		}
	}
	if idCol == nil || !idCol.IsPrimary {
		t.Fatalf("id should be marked primary, got %+v", idCol)
	}

	row, err := s.InsertRow(ctx, "main", "users", map[string]any{
		"name":  "alice",
		"score": 9.5,
	})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if got := row["name"]; got != "alice" {
		t.Fatalf("InsertRow name = %v, want alice; full row = %v", got, row)
	}
	if _, ok := row["id"]; !ok {
		t.Fatalf("InsertRow should include the integer PK, got %v", row)
	}

	r, err := s.Execute(ctx, "SELECT name, score FROM users WHERE name = 'alice'")
	if err != nil {
		t.Fatalf("select: %v", err)
	}
	if r.RowCount != 1 || r.Rows[0][0] != "alice" {
		t.Fatalf("unexpected select result: %+v", r)
	}

	r2, err := s.QueryTable(ctx, database.TableDataRequest{Schema: "main", Table: "users", Limit: 10})
	if err != nil {
		t.Fatalf("query table: %v", err)
	}
	if r2.RowCount != 1 || r2.TableName != "users" || len(r2.PrimaryKeys) != 1 {
		t.Fatalf("unexpected table query: %+v", r2)
	}

	if err := s.UpdateRow(ctx, database.RowUpdate{
		Schema:     "main",
		Table:      "users",
		PrimaryKey: map[string]any{"id": r2.Rows[0][0]},
		Changes:    map[string]any{"score": 10.0},
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	n, err := s.DeleteRows(ctx, database.RowDelete{
		Schema:      "main",
		Table:       "users",
		PrimaryKeys: []map[string]any{{"id": r2.Rows[0][0]}},
	})
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 row deleted, got %d", n)
	}
}

func TestUpdateRowWithoutPrimaryKeyFails(t *testing.T) {
	s := newTestSession(t)
	ctx := context.Background()
	if _, err := s.Execute(ctx, `CREATE TABLE k (a INTEGER, b TEXT)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.UpdateRow(ctx, database.RowUpdate{
		Schema:     "main",
		Table:      "k",
		PrimaryKey: map[string]any{"a": 1},
		Changes:    map[string]any{"b": "x"},
	}); err == nil {
		t.Fatal("expected error for table without primary key")
	}
}

func TestExecuteUnknownTableSurfacesError(t *testing.T) {
	s := newTestSession(t)
	if _, err := s.Execute(context.Background(), "SELECT * FROM nope"); err == nil {
		t.Fatal("expected error for missing table")
	}
}

func newReadOnlyTestSession(t *testing.T) database.Session {
	t.Helper()
	dir := t.TempDir()
	cfg := database.ConnectionConfig{
		ID:       "test-ro",
		Driver:   database.DriverSQLite,
		FilePath: filepath.Join(dir, "test.db"),
		ReadOnly: true,
	}
	d := &Driver{}
	s, err := d.Connect(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// Defense-in-depth: read-only session rejects destructive SQL even if the app-layer gate is bypassed.
func TestReadOnlySessionRejectsDestructiveSQL(t *testing.T) {
	ctx := context.Background()

	dir := t.TempDir()
	dbPath := filepath.Join(dir, "shared.db")
	d := &Driver{}
	writable, err := d.Connect(ctx, database.ConnectionConfig{
		ID:       "writable",
		Driver:   database.DriverSQLite,
		FilePath: dbPath,
	})
	if err != nil {
		t.Fatalf("connect writable: %v", err)
	}
	if _, err := writable.Execute(ctx, `CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	if _, err := writable.Execute(ctx, `INSERT INTO t (id, name) VALUES (1, 'a')`); err != nil {
		t.Fatalf("seed row: %v", err)
	}
	_ = writable.Close()

	ro, err := d.Connect(ctx, database.ConnectionConfig{
		ID:       "ro",
		Driver:   database.DriverSQLite,
		FilePath: dbPath,
		ReadOnly: true,
	})
	if err != nil {
		t.Fatalf("connect read-only: %v", err)
	}
	t.Cleanup(func() { _ = ro.Close() })

	if _, err := ro.Execute(ctx, `SELECT * FROM t`); err != nil {
		t.Fatalf("SELECT should be allowed on read-only session, got %v", err)
	}

	destructive := []string{
		`UPDATE t SET name = 'b' WHERE id = 1`,
		`DELETE FROM t WHERE id = 1`,
		`INSERT INTO t (id, name) VALUES (2, 'c')`,
		`DROP TABLE t`,
		`CREATE TABLE u (id INTEGER)`,
		`UPDATE t SET name = 'b' WHERE id = 1 RETURNING *`,
		`DELETE FROM t RETURNING *`,
		`WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d`,
	}
	for _, sql := range destructive {
		if _, err := ro.Execute(ctx, sql); err == nil {
			t.Errorf("Execute(%q) on read-only session should be rejected, got nil", sql)
		}
	}

	// Row-level helpers must reject directly, not only via the SQL classifier.
	if err := ro.UpdateRow(ctx, database.RowUpdate{
		Schema:     "main",
		Table:      "t",
		PrimaryKey: map[string]any{"id": 1},
		Changes:    map[string]any{"name": "b"},
	}); err == nil {
		t.Error("UpdateRow on read-only session should be rejected")
	}
	if _, err := ro.DeleteRows(ctx, database.RowDelete{
		Schema:      "main",
		Table:       "t",
		PrimaryKeys: []map[string]any{{"id": 1}},
	}); err == nil {
		t.Error("DeleteRows on read-only session should be rejected")
	}
	if _, err := ro.InsertRow(ctx, "main", "t", map[string]any{"name": "c"}); err == nil {
		t.Error("InsertRow on read-only session should be rejected")
	}

	_ = newReadOnlyTestSession // referenced to avoid unused-helper lint
}

func TestIsSelectLike(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"SELECT 1", true},
		{"WITH c AS (SELECT 1) SELECT * FROM c", true},
		{"PRAGMA table_info(x)", true},
		{"EXPLAIN SELECT 1", true},
		{"INSERT INTO t VALUES (1)", false},
		{"UPDATE t SET x=1", false},
	}
	for _, tc := range tests {
		if got := database.IsSelectLike(database.DriverSQLite, tc.in); got != tc.want {
			t.Errorf("IsSelectLike(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
