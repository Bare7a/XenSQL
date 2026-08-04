package turso

import (
	"context"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"xensql/internal/database"
)

func newTestSession(t *testing.T) database.Session {
	t.Helper()
	return connectTo(t, filepath.Join(t.TempDir(), "test.db"), false)
}

func connectTo(t *testing.T, path string, readOnly bool) database.Session {
	t.Helper()
	return connectCfg(t, database.ConnectionConfig{
		ID:       "test",
		Driver:   database.DriverTurso,
		FilePath: path,
		ReadOnly: readOnly,
	})
}

func connectCfg(t *testing.T, cfg database.ConnectionConfig) database.Session {
	t.Helper()
	s, err := (&Driver{}).Connect(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestConnectRequiresFilePath(t *testing.T) {
	if _, err := (&Driver{}).Connect(context.Background(), database.ConnectionConfig{Driver: database.DriverTurso}); err == nil {
		t.Fatal("expected error when file path missing")
	}
}

func TestLocalPathStripsSmuggledDSNOptions(t *testing.T) {
	got := localPath("/tmp/db.turso?vfs=memory&encryption_hexkey=deadbeef&_busy_timeout=1")
	if got != "/tmp/db.turso" {
		t.Errorf("localPath should drop the query, got %q", got)
	}
	if got := localPath("/tmp/db.turso"); got != "/tmp/db.turso" {
		t.Errorf("localPath should pass a plain path through, got %q", got)
	}
}

func TestBuildTursoDSN(t *testing.T) {
	cfg := database.ConnectionConfig{FilePath: "/tmp/db.turso"}
	if got := buildTursoDSN(cfg); got != "/tmp/db.turso" {
		t.Errorf("plain connection should get a bare path, got %q", got)
	}
	cfg.ExperimentalFeatures = "views"
	if got := buildTursoDSN(cfg); got != "/tmp/db.turso?experimental=views" {
		t.Errorf("experimental features should opt in via the DSN, got %q", got)
	}
	cfg.ExperimentalFeatures = "views,encryption"
	if got := buildTursoDSN(cfg); got != "/tmp/db.turso?experimental=views%2Cencryption" {
		t.Errorf("a feature list should be passed as one escaped value, got %q", got)
	}
	// One DSN value: it must not smuggle in a second option such as vfs=memory.
	cfg.ExperimentalFeatures = "views&vfs=memory"
	got := buildTursoDSN(cfg)
	if strings.Contains(got, "&vfs=") || strings.Contains(got, "?vfs=") {
		t.Errorf("feature list must not inject another DSN option, got %q", got)
	}
	injected := database.ConnectionConfig{FilePath: "/tmp/db.turso?experimental=views&vfs=memory"}
	if got := buildTursoDSN(injected); got != "/tmp/db.turso" {
		t.Errorf("path query should be stripped, got %q", got)
	}
}

func TestNormalizeExperimentalFeatures(t *testing.T) {
	cfg := database.ConnectionConfig{
		Driver:               database.DriverTurso,
		FilePath:             "/tmp/db.turso",
		ExperimentalFeatures: "  views ,, encryption  ",
	}
	database.NormalizeConnectionConfig(&cfg)
	if cfg.ExperimentalFeatures != "views,encryption" {
		t.Errorf("features should be trimmed and de-blanked, got %q", cfg.ExperimentalFeatures)
	}
}

// Turso's bookkeeping tables live in the ordinary catalog; CDC backs sync, so a synced replica
// always has them.
func TestIsTursoInternalTable(t *testing.T) {
	internal := []string{
		"turso_cdc",
		"turso_cdc_version",
		"__turso_internal_dbsp_state_v1_mv",
		"__turso_internal_seq___turso_internal_autoincrement_turso_cdc",
		"TURSO_CDC",
	}
	for _, name := range internal {
		if !isTursoInternalTable(name) {
			t.Errorf("%q should be treated as internal", name)
		}
	}
	for _, name := range []string{"turso", "turso_users", "cdc", "my_turso_cdc", "users"} {
		if isTursoInternalTable(name) {
			t.Errorf("%q is a user table and must not be filtered", name)
		}
	}
}

func TestListTablesHidesInternalTables(t *testing.T) {
	s := newTestSession(t)
	ctx := context.Background()
	if _, err := s.Execute(ctx, `CREATE TABLE users (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	// CDC is what materialises the turso_cdc* tables.
	if _, err := s.Execute(ctx, `PRAGMA unstable_capture_data_changes_conn('full')`); err != nil {
		t.Skipf("engine does not support the CDC pragma: %v", err)
	}
	if _, err := s.Execute(ctx, `INSERT INTO users (id) VALUES (1)`); err != nil {
		t.Fatalf("insert: %v", err)
	}

	raw, err := database.SQLiteListTables(ctx, s.(*Session).DB)
	if err != nil {
		t.Fatalf("raw list: %v", err)
	}
	var sawInternal bool
	for _, tb := range raw {
		if isTursoInternalTable(tb.Name) {
			sawInternal = true
		}
	}
	if !sawInternal {
		t.Skip("engine created no internal tables, nothing to filter")
	}

	tables, err := s.ListTables(ctx, "main")
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	names := make([]string, 0, len(tables))
	for _, tb := range tables {
		if isTursoInternalTable(tb.Name) {
			t.Errorf("internal table %q leaked into the schema tree", tb.Name)
		}
		names = append(names, tb.Name)
	}
	if !slices.Contains(names, "users") {
		t.Errorf("the user table should still be listed, got %v", names)
	}
}

func TestExperimentalViews(t *testing.T) {
	ctx := context.Background()
	create := `CREATE MATERIALIZED VIEW mv AS SELECT k, COUNT(*) c FROM t GROUP BY k`

	off := newTestSession(t)
	if _, err := off.Execute(ctx, `CREATE TABLE t (id INTEGER PRIMARY KEY, k TEXT)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := off.Execute(ctx, create); err == nil {
		t.Error("materialized views should be rejected unless the connection opts in")
	}

	on := connectCfg(t, database.ConnectionConfig{
		ID:                   "test-exp",
		Driver:               database.DriverTurso,
		FilePath:             filepath.Join(t.TempDir(), "exp.db"),
		ExperimentalFeatures: "views",
	})
	if _, err := on.Execute(ctx, `CREATE TABLE t (id INTEGER PRIMARY KEY, k TEXT)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := on.Execute(ctx, create); err != nil {
		t.Fatalf("materialized view should be accepted when opted in: %v", err)
	}
	tables, err := on.ListTables(ctx, "main")
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	kinds := make(map[string]string, len(tables))
	for _, tb := range tables {
		kinds[tb.Name] = tb.Type
	}
	if kinds["mv"] != "view" {
		t.Errorf("materialized view should be listed as a view, got %+v", kinds)
	}
	for name := range kinds {
		if isTursoInternalTable(name) {
			t.Errorf("internal table %q leaked into the schema tree", name)
		}
	}
}

func TestSessionPragmas(t *testing.T) {
	writable := sessionPragmas(database.ConnectionConfig{})
	if len(writable) != 1 || !strings.Contains(writable[0], "foreign_keys") {
		t.Fatalf("writable connection should only force foreign keys on, got %v", writable)
	}
	ro := sessionPragmas(database.ConnectionConfig{ReadOnly: true})
	if len(ro) != 2 || !strings.Contains(ro[1], "query_only") {
		t.Fatalf("read-only connection should add query_only, got %v", ro)
	}
	// foreign_keys first: query_only refuses further state changes.
	if !strings.Contains(ro[0], "foreign_keys") {
		t.Errorf("foreign_keys should be set first, got %v", ro)
	}
}

func TestRemoteHost(t *testing.T) {
	if got := remoteHost(""); got != "" {
		t.Errorf("local database should have no remote host, got %q", got)
	}
	if got := remoteHost("https://db-org.turso.io"); got != "db-org.turso.io" {
		t.Errorf("remoteHost = %q, want db-org.turso.io", got)
	}
}

func TestValidateRemoteURL(t *testing.T) {
	base := database.ConnectionConfig{Driver: database.DriverTurso, FilePath: "/tmp/x.db"}
	if err := database.ValidateConnectionConfig(base); err != nil {
		t.Fatalf("local-only config should be valid, got %v", err)
	}
	base.RemoteURL = "https://db-org.turso.io"
	if err := database.ValidateConnectionConfig(base); err != nil {
		t.Fatalf("https remote should be valid, got %v", err)
	}
	for _, bad := range []string{"db-org.turso.io", "libsql://db-org.turso.io", "https://"} {
		base.RemoteURL = bad
		if err := database.ValidateConnectionConfig(base); err == nil {
			t.Errorf("remote URL %q should be rejected", bad)
		}
	}
}

func TestSessionPingAndSchemaInfo(t *testing.T) {
	s := newTestSession(t)
	ctx := context.Background()
	if err := s.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	if s.DriverType() != database.DriverTurso {
		t.Errorf("DriverType = %q, want turso", s.DriverType())
	}
	schemas, err := s.ListSchemas(ctx)
	if err != nil || len(schemas) != 1 || schemas[0].Name != "main" {
		t.Fatalf("ListSchemas got %+v err=%v", schemas, err)
	}
	info, err := s.ConnectionInfo(ctx)
	if err != nil || info.Database != "main" {
		t.Fatalf("ConnectionInfo got %+v err=%v", info, err)
	}
	if info.Host != "" {
		t.Errorf("local session should report no host, got %q", info.Host)
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
	if fk := byName["author_id"]; !fk.IsForeign || fk.ForeignTable != "authors" || fk.ForeignColumn != "id" {
		t.Fatalf("author_id should reference authors(id), got %+v", fk)
	}
	if byName["author_id"].IsPrimary {
		t.Errorf("author_id should not be marked primary, got %+v", byName["author_id"])
	}
	if !byName["id"].IsPrimary {
		t.Errorf("id should be marked primary, got %+v", byName["id"])
	}
	if byName["title"].IsForeign {
		t.Errorf("title should not be marked foreign, got %+v", byName["title"])
	}
}

// Turso defaults foreign_keys to OFF; the driver forces it on to match SQLite.
func TestForeignKeysAreEnforced(t *testing.T) {
	s := newTestSession(t)
	ctx := context.Background()
	if _, err := s.Execute(ctx, `CREATE TABLE authors (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatalf("create parent: %v", err)
	}
	if _, err := s.Execute(ctx, `CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES authors(id))`); err != nil {
		t.Fatalf("create child: %v", err)
	}
	if _, err := s.Execute(ctx, `INSERT INTO books (author_id) VALUES (404)`); err == nil {
		t.Error("insert violating a foreign key should be rejected")
	}
	// Also on the row-editing path, which goes straight to *sql.DB.
	if _, err := s.InsertRow(ctx, "main", "books", map[string]any{"author_id": 404}); err == nil {
		t.Error("InsertRow violating a foreign key should be rejected")
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
	if len(tables) != 1 || tables[0].Name != "users" || tables[0].Type != "table" {
		t.Fatalf("expected one table, got %+v", tables)
	}

	row, err := s.InsertRow(ctx, "main", "users", map[string]any{"name": "alice", "score": 9.5})
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
		PrimaryKey: map[string]any{"id": row["id"]},
		Changes:    map[string]any{"score": 10.0},
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	n, err := s.DeleteRows(ctx, database.RowDelete{
		Schema:      "main",
		Table:       "users",
		PrimaryKeys: []map[string]any{{"id": row["id"]}},
	})
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 row deleted, got %d", n)
	}
}

func TestListTablesIncludesViews(t *testing.T) {
	s := newTestSession(t)
	ctx := context.Background()
	if _, err := s.Execute(ctx, `CREATE TABLE t (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.Execute(ctx, `CREATE VIEW v AS SELECT * FROM t`); err != nil {
		t.Fatalf("create view: %v", err)
	}
	tables, err := s.ListTables(ctx, "main")
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	kinds := make(map[string]string, len(tables))
	for _, tb := range tables {
		kinds[tb.Name] = tb.Type
	}
	if kinds["t"] != "table" || kinds["v"] != "view" {
		t.Fatalf("expected t=table and v=view, got %+v", kinds)
	}
}

func TestPinnedConnRunsScript(t *testing.T) {
	s := newTestSession(t)
	ctx := context.Background()
	pc, err := s.PinnedConn(ctx)
	if err != nil {
		t.Fatalf("pinned conn: %v", err)
	}
	statements := database.SplitStatements(database.DriverTurso,
		`CREATE TABLE s (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO s (v) VALUES ('a'); INSERT INTO s (v) VALUES ('b');`)
	sink := database.ScriptSink{
		OnResult: func(_ int, _ *database.QueryResult, statement string, err error) {
			if err != nil {
				t.Errorf("statement %q failed: %v", statement, err)
			}
		},
	}
	if err := pc.ExecuteScript(ctx, statements, sink); err != nil {
		t.Fatalf("script: %v", err)
	}
	pc.Close()

	r, err := s.Execute(ctx, `SELECT COUNT(*) FROM s`)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if got := r.Rows[0][0]; got != int64(2) {
		t.Fatalf("expected 2 rows inserted, got %v", got)
	}
}

func TestTransactionRollbackDiscardsWrites(t *testing.T) {
	s := newTestSession(t)
	ctx := context.Background()
	if _, err := s.Execute(ctx, `CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	txn, err := s.BeginTxn(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := txn.ExecuteStream(ctx, `INSERT INTO t (v) VALUES ('a')`, database.StreamOpts{}); err != nil {
		t.Fatalf("insert in txn: %v", err)
	}
	if err := txn.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	txn.Close()

	r, err := s.Execute(ctx, `SELECT COUNT(*) FROM t`)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if got := r.Rows[0][0]; got != int64(0) {
		t.Fatalf("rollback should have discarded the insert, got %v rows", got)
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

// Defense-in-depth: destructive SQL is rejected even if the app-layer gate is bypassed.
func TestReadOnlySessionRejectsDestructiveSQL(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "shared.db")

	writable := connectTo(t, dbPath, false)
	if _, err := writable.Execute(ctx, `CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	if _, err := writable.Execute(ctx, `INSERT INTO t (id, name) VALUES (1, 'a')`); err != nil {
		t.Fatalf("seed row: %v", err)
	}
	if err := writable.Close(); err != nil {
		t.Fatalf("close writable: %v", err)
	}

	ro := connectTo(t, dbPath, true)
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
}

// A pinned connection bypasses the statement classifier, so only query_only can reject this.
func TestReadOnlyEnforcedByEngine(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "engine.db")

	writable := connectTo(t, dbPath, false)
	if _, err := writable.Execute(ctx, `CREATE TABLE t (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := writable.Close(); err != nil {
		t.Fatalf("close writable: %v", err)
	}

	ro := connectTo(t, dbPath, true)
	pc, err := ro.PinnedConn(ctx)
	if err != nil {
		t.Fatalf("pinned conn: %v", err)
	}
	defer pc.Close()
	if _, err := pc.ExecuteStream(ctx, `INSERT INTO t (id) VALUES (1)`, database.StreamOpts{}); err == nil {
		t.Error("query_only should make the engine reject a write on a read-only connection")
	}
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
		if got := database.IsSelectLike(database.DriverTurso, tc.in); got != tc.want {
			t.Errorf("IsSelectLike(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
