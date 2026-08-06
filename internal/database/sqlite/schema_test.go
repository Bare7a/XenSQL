package sqlite

import (
	"context"
	"strings"
	"testing"

	"xensql/internal/database"
)

func seedSchemaObjects(t *testing.T, s database.Session) {
	t.Helper()
	ctx := context.Background()
	stmts := []string{
		`CREATE TABLE orgs (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`,
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			email TEXT NOT NULL UNIQUE,
			org_id INTEGER,
			nickname TEXT,
			FOREIGN KEY (org_id) REFERENCES orgs(id)
		)`,
		`CREATE INDEX users_nickname_idx ON users (nickname)`,
		`CREATE TRIGGER users_touch AFTER UPDATE ON users BEGIN SELECT 1; END`,
	}
	for _, stmt := range stmts {
		if _, err := s.Execute(ctx, stmt); err != nil {
			t.Fatalf("seed %q: %v", stmt, err)
		}
	}
}

func TestListIndexes(t *testing.T) {
	s := newTestSession(t)
	seedSchemaObjects(t, s)

	indexes, err := s.ListIndexes(context.Background(), "main", "users")
	if err != nil {
		t.Fatalf("ListIndexes: %v", err)
	}
	byName := map[string]database.IndexInfo{}
	for _, idx := range indexes {
		byName[idx.Name] = idx
	}

	explicit, ok := byName["users_nickname_idx"]
	if !ok {
		t.Fatalf("missing explicit index, got %+v", indexes)
	}
	if explicit.IsUnique || explicit.IsPrimary {
		t.Errorf("users_nickname_idx should be a plain index, got %+v", explicit)
	}
	if len(explicit.Columns) != 1 || explicit.Columns[0] != "nickname" {
		t.Errorf("users_nickname_idx columns = %v, want [nickname]", explicit.Columns)
	}

	var foundUnique bool
	for _, idx := range indexes {
		if idx.IsUnique && len(idx.Columns) == 1 && idx.Columns[0] == "email" {
			foundUnique = true
		}
	}
	if !foundUnique {
		t.Errorf("expected a unique index over email, got %+v", indexes)
	}
}

func TestListConstraints(t *testing.T) {
	s := newTestSession(t)
	seedSchemaObjects(t, s)

	constraints, err := s.ListConstraints(context.Background(), "main", "users")
	if err != nil {
		t.Fatalf("ListConstraints: %v", err)
	}
	byType := map[string]database.ConstraintInfo{}
	for _, c := range constraints {
		byType[c.Type] = c
	}

	pk, ok := byType["PRIMARY KEY"]
	if !ok || len(pk.Columns) != 1 || pk.Columns[0] != "id" {
		t.Errorf("PRIMARY KEY constraint = %+v, want columns [id]", pk)
	}
	if _, ok := byType["UNIQUE"]; !ok {
		t.Errorf("expected a UNIQUE constraint, got %+v", constraints)
	}
	fk, ok := byType["FOREIGN KEY"]
	if !ok {
		t.Fatalf("expected a FOREIGN KEY constraint, got %+v", constraints)
	}
	if fk.RefTable != "orgs" {
		t.Errorf("FK ref table = %q, want orgs", fk.RefTable)
	}
	if len(fk.Columns) != 1 || fk.Columns[0] != "org_id" {
		t.Errorf("FK columns = %v, want [org_id]", fk.Columns)
	}
	if len(fk.RefColumns) != 1 || fk.RefColumns[0] != "id" {
		t.Errorf("FK ref columns = %v, want [id]", fk.RefColumns)
	}
}

func TestListConstraintsGroupsCompositeForeignKey(t *testing.T) {
	s := newTestSession(t)
	ctx := context.Background()
	for _, stmt := range []string{
		`CREATE TABLE parent (a INTEGER, b INTEGER, PRIMARY KEY (a, b))`,
		`CREATE TABLE child (x INTEGER, y INTEGER, FOREIGN KEY (x, y) REFERENCES parent(a, b))`,
	} {
		if _, err := s.Execute(ctx, stmt); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	constraints, err := s.ListConstraints(ctx, "main", "child")
	if err != nil {
		t.Fatalf("ListConstraints: %v", err)
	}
	var fks []database.ConstraintInfo
	for _, c := range constraints {
		if c.Type == "FOREIGN KEY" {
			fks = append(fks, c)
		}
	}
	if len(fks) != 1 {
		t.Fatalf("composite FK should be one constraint, got %d: %+v", len(fks), fks)
	}
	if strings.Join(fks[0].Columns, ",") != "x,y" {
		t.Errorf("FK columns = %v, want [x y]", fks[0].Columns)
	}
	if strings.Join(fks[0].RefColumns, ",") != "a,b" {
		t.Errorf("FK ref columns = %v, want [a b]", fks[0].RefColumns)
	}
}

func TestListTriggers(t *testing.T) {
	s := newTestSession(t)
	seedSchemaObjects(t, s)

	triggers, err := s.ListTriggers(context.Background(), "main", "users")
	if err != nil {
		t.Fatalf("ListTriggers: %v", err)
	}
	if len(triggers) != 1 {
		t.Fatalf("expected 1 trigger, got %+v", triggers)
	}
	if triggers[0].Name != "users_touch" {
		t.Errorf("trigger name = %q", triggers[0].Name)
	}
	if triggers[0].Timing != "AFTER" || triggers[0].Events != "UPDATE" {
		t.Errorf("trigger timing/events = %q/%q, want AFTER/UPDATE", triggers[0].Timing, triggers[0].Events)
	}
}

func TestListRoutinesIsEmpty(t *testing.T) {
	s := newTestSession(t)
	routines, err := s.ListRoutines(context.Background(), "main")
	if err != nil {
		t.Fatalf("ListRoutines: %v", err)
	}
	if len(routines) != 0 {
		t.Errorf("SQLite has no routines, got %+v", routines)
	}
}

func TestObjectDDL(t *testing.T) {
	s := newTestSession(t)
	seedSchemaObjects(t, s)
	ctx := context.Background()

	t.Run("table includes its standalone indexes", func(t *testing.T) {
		ddl, err := s.ObjectDDL(ctx, database.ObjectRef{Kind: database.ObjectTable, Schema: "main", Name: "users"})
		if err != nil {
			t.Fatalf("ObjectDDL: %v", err)
		}
		if !strings.Contains(ddl, "CREATE TABLE users") {
			t.Errorf("missing CREATE TABLE in:\n%s", ddl)
		}
		if !strings.Contains(ddl, "CREATE INDEX users_nickname_idx") {
			t.Errorf("missing the table's index in:\n%s", ddl)
		}
		if !strings.HasSuffix(ddl, ";") {
			t.Errorf("DDL should be terminated:\n%s", ddl)
		}
	})

	t.Run("trigger", func(t *testing.T) {
		ddl, err := s.ObjectDDL(ctx, database.ObjectRef{
			Kind: database.ObjectTrigger, Schema: "main", Name: "users_touch", Table: "users",
		})
		if err != nil {
			t.Fatalf("ObjectDDL: %v", err)
		}
		if !strings.Contains(ddl, "CREATE TRIGGER users_touch") {
			t.Errorf("unexpected trigger DDL:\n%s", ddl)
		}
	})

	t.Run("explicit index", func(t *testing.T) {
		ddl, err := s.ObjectDDL(ctx, database.ObjectRef{
			Kind: database.ObjectIndex, Schema: "main", Name: "users_nickname_idx", Table: "users",
		})
		if err != nil {
			t.Fatalf("ObjectDDL: %v", err)
		}
		if !strings.Contains(ddl, "CREATE INDEX users_nickname_idx") {
			t.Errorf("unexpected index DDL:\n%s", ddl)
		}
	})

	t.Run("constraint falls back to the owning table", func(t *testing.T) {
		ddl, err := s.ObjectDDL(ctx, database.ObjectRef{
			Kind: database.ObjectConstraint, Schema: "main", Name: "pk", Table: "users",
		})
		if err != nil {
			t.Fatalf("ObjectDDL: %v", err)
		}
		if !strings.Contains(ddl, "CREATE TABLE users") {
			t.Errorf("constraint DDL should show the table:\n%s", ddl)
		}
	})

	t.Run("routines are unsupported", func(t *testing.T) {
		if _, err := s.ObjectDDL(ctx, database.ObjectRef{
			Kind: database.ObjectFunction, Schema: "main", Name: "whatever",
		}); err == nil {
			t.Error("expected an unsupported-kind error")
		}
	})

	t.Run("missing object reports not found", func(t *testing.T) {
		if _, err := s.ObjectDDL(ctx, database.ObjectRef{
			Kind: database.ObjectTable, Schema: "main", Name: "nope",
		}); err == nil {
			t.Error("expected a not-found error")
		}
	})
}

func TestParseTriggerHead(t *testing.T) {
	tests := []struct {
		name       string
		ddl        string
		wantTiming string
		wantEvents string
	}{
		{
			name:       "explicit after update",
			ddl:        "CREATE TRIGGER t AFTER UPDATE ON users BEGIN SELECT 1; END",
			wantTiming: "AFTER",
			wantEvents: "UPDATE",
		},
		{
			name:       "implicit timing defaults to before",
			ddl:        "CREATE TRIGGER t DELETE ON users BEGIN SELECT 1; END",
			wantTiming: "BEFORE",
			wantEvents: "DELETE",
		},
		{
			name:       "instead of on a view",
			ddl:        "CREATE TRIGGER t INSTEAD OF INSERT ON v BEGIN SELECT 1; END",
			wantTiming: "INSTEAD OF",
			wantEvents: "INSERT",
		},
		{
			name:       "temporary trigger with if not exists",
			ddl:        "CREATE TEMPORARY TRIGGER IF NOT EXISTS t BEFORE INSERT ON users BEGIN SELECT 1; END",
			wantTiming: "BEFORE",
			wantEvents: "INSERT",
		},
		{
			name:       "update of named columns",
			ddl:        "CREATE TRIGGER t AFTER UPDATE OF email, nickname ON users BEGIN SELECT 1; END",
			wantTiming: "AFTER",
			wantEvents: "UPDATE",
		},
		{
			name:       "unparseable statement",
			ddl:        "",
			wantTiming: "",
			wantEvents: "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			timing, events := parseTriggerHead(tc.ddl)
			if timing != tc.wantTiming || events != tc.wantEvents {
				t.Errorf("parseTriggerHead(%q) = %q/%q, want %q/%q",
					tc.ddl, timing, events, tc.wantTiming, tc.wantEvents)
			}
		})
	}
}
