//go:build e2e

package app

import (
	"fmt"
	"strings"
	"testing"

	"xensql/internal/database"
)

func createFunctionSQL(e engine, name string) string {
	if e.driver == database.DriverPostgres {
		return fmt.Sprintf(`CREATE FUNCTION %s(a int) RETURNS int LANGUAGE sql AS $$ SELECT a + 1 $$`, name)
	}
	return fmt.Sprintf(`CREATE FUNCTION %s(a INT) RETURNS INT DETERMINISTIC RETURN a + 1`, name)
}

func createTriggerSQL(e engine, trigger, table, helperFn string) []string {
	target := qualified(e, table)
	if e.driver == database.DriverPostgres {
		return []string{
			fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`, helperFn),
			fmt.Sprintf(`CREATE TRIGGER %s AFTER UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION %s()`, trigger, target, helperFn),
		}
	}
	return []string{
		fmt.Sprintf(`CREATE TRIGGER %s AFTER UPDATE ON %s FOR EACH ROW SET @xensql_e2e = 1`, trigger, target),
	}
}

func dropQuietly(t *testing.T, a *App, connID, stmt string) {
	t.Helper()
	t.Cleanup(func() { _, _ = a.ExecuteQuery(connID, stmt) })
}

func indexNamed(indexes []database.IndexInfo, name string) (database.IndexInfo, bool) {
	for _, idx := range indexes {
		if idx.Name == name {
			return idx, true
		}
	}
	return database.IndexInfo{}, false
}

func constraintOfType(constraints []database.ConstraintInfo, ctype string) (database.ConstraintInfo, bool) {
	for _, c := range constraints {
		if c.Type == ctype {
			return c, true
		}
	}
	return database.ConstraintInfo{}, false
}

// The table DDL is verified by round-trip: drop it, replay the generated statements, check the
// shape returns.
func TestE2EObjectDDL(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		parent := uniqueTable("ddl_orgs")
		child := uniqueTable("ddl_users")
		indexName := child + "_nickname_idx"

		createTempTable(t, a, e, connID, e.autoPKTable(parent), parent)

		notNullText := "VARCHAR(255)"
		if e.driver == database.DriverPostgres {
			notNullText = "TEXT"
		}
		childDDL := fmt.Sprintf(
			`CREATE TABLE %s (%s, email %s NOT NULL UNIQUE, nickname %s, org_id INT, `+
				`CONSTRAINT %s_org_fk FOREIGN KEY (org_id) REFERENCES %s(id))`,
			qualified(e, child), pkColumn(e), notNullText, notNullText, child, qualified(e, parent))
		createTempTable(t, a, e, connID, childDDL, child)
		mustExec(t, a, connID, fmt.Sprintf("CREATE INDEX %s ON %s (nickname)", indexName, qualified(e, child)))

		t.Run("ListIndexes", func(t *testing.T) {
			indexes, err := a.ListIndexes(connID, e.browseSchema, child)
			if err != nil {
				t.Fatalf("ListIndexes: %v", err)
			}
			idx, ok := indexNamed(indexes, indexName)
			if !ok {
				t.Fatalf("index %q missing from %+v", indexName, indexes)
			}
			if idx.IsUnique || idx.IsPrimary {
				t.Errorf("%q should be a plain index, got %+v", indexName, idx)
			}
			if len(idx.Columns) != 1 || idx.Columns[0] != "nickname" {
				t.Errorf("%q columns = %v, want [nickname]", indexName, idx.Columns)
			}
			var hasPrimary bool
			for _, i := range indexes {
				if i.IsPrimary {
					hasPrimary = true
				}
			}
			if !hasPrimary {
				t.Errorf("expected a primary-key index among %+v", indexes)
			}
		})

		t.Run("ListConstraints", func(t *testing.T) {
			constraints, err := a.ListConstraints(connID, e.browseSchema, child)
			if err != nil {
				t.Fatalf("ListConstraints: %v", err)
			}
			pk, ok := constraintOfType(constraints, "PRIMARY KEY")
			if !ok {
				t.Fatalf("no PRIMARY KEY among %+v", constraints)
			}
			if len(pk.Columns) != 1 || pk.Columns[0] != "id" {
				t.Errorf("PK columns = %v, want [id]", pk.Columns)
			}
			if _, ok := constraintOfType(constraints, "UNIQUE"); !ok {
				t.Errorf("no UNIQUE among %+v", constraints)
			}
			fk, ok := constraintOfType(constraints, "FOREIGN KEY")
			if !ok {
				t.Fatalf("no FOREIGN KEY among %+v", constraints)
			}
			if fk.RefTable != parent {
				t.Errorf("FK ref table = %q, want %q", fk.RefTable, parent)
			}
			if len(fk.Columns) != 1 || fk.Columns[0] != "org_id" {
				t.Errorf("FK columns = %v, want [org_id]", fk.Columns)
			}
		})

		t.Run("ListTriggers", func(t *testing.T) {
			trigger := uniqueTable("ddl_trg")
			helperFn := uniqueTable("ddl_trgfn")
			for _, stmt := range createTriggerSQL(e, trigger, child, helperFn) {
				mustExec(t, a, connID, stmt)
			}
			if e.driver == database.DriverPostgres {
				dropQuietly(t, a, connID, "DROP FUNCTION IF EXISTS "+helperFn+"() CASCADE")
			}

			triggers, err := a.ListTriggers(connID, e.browseSchema, child)
			if err != nil {
				t.Fatalf("ListTriggers: %v", err)
			}
			var found *database.TriggerInfo
			for i := range triggers {
				if triggers[i].Name == trigger {
					found = &triggers[i]
				}
			}
			if found == nil {
				t.Fatalf("trigger %q missing from %+v", trigger, triggers)
			}
			if found.Timing != "AFTER" {
				t.Errorf("trigger timing = %q, want AFTER", found.Timing)
			}
			if !strings.Contains(found.Events, "UPDATE") {
				t.Errorf("trigger events = %q, want to contain UPDATE", found.Events)
			}

			ddl, err := a.GetObjectDDL(connID, database.ObjectRef{
				Kind: database.ObjectTrigger, Schema: e.browseSchema, Name: trigger, Table: child,
			})
			if err != nil {
				t.Fatalf("trigger DDL: %v", err)
			}
			// MySQL puts DEFINER=... between the two words.
			upper := strings.ToUpper(ddl)
			if !strings.HasPrefix(upper, "CREATE") || !strings.Contains(upper, "TRIGGER") ||
				!strings.Contains(ddl, trigger) {
				t.Errorf("trigger DDL should create %q:\n%s", trigger, ddl)
			}
		})

		t.Run("ListRoutines", func(t *testing.T) {
			fn := uniqueTable("ddl_fn")
			mustExec(t, a, connID, createFunctionSQL(e, fn))
			drop := "DROP FUNCTION IF EXISTS " + fn
			if e.driver == database.DriverPostgres {
				drop += "(int)"
			}
			dropQuietly(t, a, connID, drop)

			routines, err := a.ListRoutines(connID, e.browseSchema)
			if err != nil {
				t.Fatalf("ListRoutines: %v", err)
			}
			var found *database.RoutineInfo
			for i := range routines {
				if routines[i].Name == fn {
					found = &routines[i]
				}
			}
			if found == nil {
				t.Fatalf("function %q missing from %d routines", fn, len(routines))
			}
			if found.Kind != database.ObjectFunction {
				t.Errorf("routine kind = %q, want function", found.Kind)
			}

			ddl, err := a.GetObjectDDL(connID, database.ObjectRef{
				Kind: database.ObjectFunction, Schema: e.browseSchema, Name: fn, Args: found.Args,
			})
			if err != nil {
				t.Fatalf("function DDL: %v", err)
			}
			if !strings.Contains(strings.ToUpper(ddl), "FUNCTION") {
				t.Errorf("function DDL should mention FUNCTION:\n%s", ddl)
			}
		})

		t.Run("IndexDDL", func(t *testing.T) {
			ddl, err := a.GetObjectDDL(connID, database.ObjectRef{
				Kind: database.ObjectIndex, Schema: e.browseSchema, Name: indexName, Table: child,
			})
			if err != nil {
				t.Fatalf("index DDL: %v", err)
			}
			if !strings.Contains(strings.ToUpper(ddl), "CREATE INDEX") {
				t.Errorf("index DDL should be a CREATE INDEX:\n%s", ddl)
			}
			if !strings.Contains(ddl, "nickname") {
				t.Errorf("index DDL should name its column:\n%s", ddl)
			}
		})

		t.Run("ConstraintDDL", func(t *testing.T) {
			ddl, err := a.GetObjectDDL(connID, database.ObjectRef{
				Kind: database.ObjectConstraint, Schema: e.browseSchema,
				Name: child + "_org_fk", Table: child,
			})
			if err != nil {
				t.Fatalf("constraint DDL: %v", err)
			}
			upper := strings.ToUpper(ddl)
			if !strings.Contains(upper, "ALTER TABLE") || !strings.Contains(upper, "FOREIGN KEY") {
				t.Errorf("constraint DDL should be an ALTER TABLE ... FOREIGN KEY:\n%s", ddl)
			}
		})

		t.Run("ViewDDL", func(t *testing.T) {
			view := uniqueTable("ddl_view")
			mustExec(t, a, connID, fmt.Sprintf("CREATE VIEW %s AS SELECT id, email FROM %s",
				qualified(e, view), qualified(e, child)))
			dropQuietly(t, a, connID, "DROP VIEW IF EXISTS "+qualified(e, view))

			ddl, err := a.GetObjectDDL(connID, database.ObjectRef{
				Kind: database.ObjectView, Schema: e.browseSchema, Name: view,
			})
			if err != nil {
				t.Fatalf("view DDL: %v", err)
			}
			if !strings.Contains(strings.ToUpper(ddl), "VIEW") {
				t.Errorf("view DDL should mention VIEW:\n%s", ddl)
			}
		})

		t.Run("TableDDLRoundTrips", func(t *testing.T) {
			ddl, err := a.GetObjectDDL(connID, database.ObjectRef{
				Kind: database.ObjectTable, Schema: e.browseSchema, Name: child,
			})
			if err != nil {
				t.Fatalf("table DDL: %v", err)
			}
			if !strings.Contains(strings.ToUpper(ddl), "CREATE TABLE") {
				t.Fatalf("table DDL should be a CREATE TABLE:\n%s", ddl)
			}

			before, err := a.ListColumns(connID, e.browseSchema, child)
			if err != nil {
				t.Fatalf("ListColumns before: %v", err)
			}

			mustExec(t, a, connID, "DROP TABLE "+qualified(e, child))
			for _, stmt := range database.SplitStatements(e.driver, ddl) {
				if _, err := a.ExecuteQuery(connID, stmt); err != nil {
					t.Fatalf("replaying generated DDL failed on %q: %v\nfull DDL:\n%s", stmt, err, ddl)
				}
			}

			after, err := a.ListColumns(connID, e.browseSchema, child)
			if err != nil {
				t.Fatalf("ListColumns after: %v", err)
			}
			if len(before) != len(after) {
				t.Fatalf("column count changed: %d before, %d after\nDDL:\n%s", len(before), len(after), ddl)
			}
			for i := range before {
				if before[i].Name != after[i].Name {
					t.Errorf("column %d: %q before, %q after", i, before[i].Name, after[i].Name)
				}
				if before[i].IsPrimary != after[i].IsPrimary {
					t.Errorf("column %q primary flag changed: %v -> %v",
						before[i].Name, before[i].IsPrimary, after[i].IsPrimary)
				}
				if before[i].IsNullable != after[i].IsNullable {
					t.Errorf("column %q nullable flag changed: %v -> %v",
						before[i].Name, before[i].IsNullable, after[i].IsNullable)
				}
			}
			indexes, err := a.ListIndexes(connID, e.browseSchema, child)
			if err != nil {
				t.Fatalf("ListIndexes after: %v", err)
			}
			if _, ok := indexNamed(indexes, indexName); !ok {
				t.Errorf("index %q was lost in the round trip; DDL:\n%s", indexName, ddl)
			}
		})
	})
}
