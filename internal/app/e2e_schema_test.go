//go:build e2e

package app

import (
	"testing"

	"xensql/internal/database"
)

// TestE2ESchemaExplorer covers the Schema Explorer surface: LoadSchemaData (the
// single call the UI makes on connect), ListSchemas/ListTables/ListColumns, and
// primary/foreign-key + nullable detection - the metadata that drives the tree,
// editable-grid gating, and autocomplete.
func TestE2ESchemaExplorer(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		parent := uniqueTable("authors")
		child := uniqueTable("books")

		createTempTable(t, a, e, connID, e.autoPKTable(parent), parent)
		// child references parent(id); author_id is a nullable FK, isbn is NOT NULL.
		childDDL := "CREATE TABLE " + qualified(e, child) + " (" +
			pkColumn(e) + ", " +
			"isbn VARCHAR(32) NOT NULL, " +
			"author_id INT, " +
			"FOREIGN KEY (author_id) REFERENCES " + qualified(e, parent) + "(id))"
		createTempTable(t, a, e, connID, childDDL, child)

		t.Run("LoadSchemaData", func(t *testing.T) {
			bundle, err := a.LoadSchemaData(connID)
			if err != nil {
				t.Fatalf("LoadSchemaData: %v", err)
			}
			if !bundle.Status.Connected {
				t.Fatalf("expected Connected status, got %+v", bundle.Status)
			}
			if !hasSchema(bundle.Schemas, e.browseSchema) {
				t.Fatalf("schemas %+v missing browse schema %q", bundle.Schemas, e.browseSchema)
			}
			// The browse schema's tables should be preloaded so the tree renders without a round-trip.
			if !loadedTablesInclude(bundle.LoadedTables, e.browseSchema, parent) {
				t.Fatalf("expected %q preloaded in LoadedTables, got %+v", parent, bundle.LoadedTables)
			}
		})

		t.Run("ListTables", func(t *testing.T) {
			tables, err := a.ListTables(connID, e.browseSchema)
			if err != nil {
				t.Fatalf("ListTables: %v", err)
			}
			if !tableNamed(tables, parent) || !tableNamed(tables, child) {
				t.Fatalf("expected %q and %q in %+v", parent, child, tableNames(tables))
			}
			for _, tbl := range tables {
				if tbl.Name == parent && tbl.Type != "table" {
					t.Errorf("%q should be type 'table', got %q", parent, tbl.Type)
				}
			}
		})

		t.Run("ListColumns_keys_and_nullability", func(t *testing.T) {
			cols, err := a.ListColumns(connID, e.browseSchema, child)
			if err != nil {
				t.Fatalf("ListColumns: %v", err)
			}
			by := indexColumns(cols)

			id, ok := by["id"]
			if !ok || !id.IsPrimary {
				t.Errorf("id should be primary, got %+v", id)
			}
			if id.IsForeign {
				t.Errorf("id should not be foreign, got %+v", id)
			}
			fk, ok := by["author_id"]
			if !ok || !fk.IsForeign {
				t.Errorf("author_id should be foreign, got %+v", fk)
			}
			if fk.IsPrimary {
				t.Errorf("author_id should not be primary, got %+v", fk)
			}
			if !fk.IsNullable {
				t.Errorf("author_id was declared nullable, got IsNullable=false (%+v)", fk)
			}
			if isbn, ok := by["isbn"]; !ok || isbn.IsNullable {
				t.Errorf("isbn was declared NOT NULL, got %+v", isbn)
			}
			if dt := by["isbn"].DataType; dt == "" {
				t.Errorf("isbn should report a data type, got empty")
			}
		})

		t.Run("ListColumns_unknown_table_is_empty", func(t *testing.T) {
			cols, err := a.ListColumns(connID, e.browseSchema, "no_such_table_"+child)
			if err != nil {
				t.Fatalf("ListColumns on missing table should not error, got %v", err)
			}
			if len(cols) != 0 {
				t.Fatalf("expected no columns for missing table, got %+v", cols)
			}
		})
	})
}

// TestE2EViews verifies views are discovered and typed as views (the explorer
// shows them under a table's sibling node and they are browsable but not editable).
func TestE2EViews(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		base := uniqueTable("v_base")
		view := uniqueTable("v_view")
		createTempTable(t, a, e, connID, e.autoPKTable(base), base)
		mustExec(t, a, connID, "INSERT INTO "+qualified(e, base)+" (name) VALUES ('x')")

		mustExec(t, a, connID, "CREATE VIEW "+qualified(e, view)+" AS SELECT id, name FROM "+qualified(e, base))
		t.Cleanup(func() { _, _ = a.ExecuteQuery(connID, "DROP VIEW IF EXISTS "+qualified(e, view)) })

		tables, err := a.ListTables(connID, e.browseSchema)
		if err != nil {
			t.Fatalf("ListTables: %v", err)
		}
		var found *database.TableInfo
		for i := range tables {
			if tables[i].Name == view {
				found = &tables[i]
			}
		}
		if found == nil {
			t.Fatalf("view %q not listed in %+v", view, tableNames(tables))
		}
		if found.Type != "view" {
			t.Errorf("expected type 'view' for %q, got %q", view, found.Type)
		}
	})
}

// --- helpers ---

// pkColumn is the auto-increment integer PK column declaration for the engine.
func pkColumn(e engine) string {
	if e.driver == database.DriverPostgres {
		return "id SERIAL PRIMARY KEY"
	}
	return "id INT AUTO_INCREMENT PRIMARY KEY"
}

func hasSchema(schemas []database.SchemaInfo, name string) bool {
	for _, s := range schemas {
		if s.Name == name {
			return true
		}
	}
	return false
}

func loadedTablesInclude(loaded []database.SchemaTables, schema, table string) bool {
	for _, st := range loaded {
		if st.Schema != schema {
			continue
		}
		if tableNamed(st.Tables, table) {
			return true
		}
	}
	return false
}

func tableNamed(tables []database.TableInfo, name string) bool {
	for _, tbl := range tables {
		if tbl.Name == name {
			return true
		}
	}
	return false
}

func tableNames(tables []database.TableInfo) []string {
	out := make([]string, len(tables))
	for i, tbl := range tables {
		out[i] = tbl.Name
	}
	return out
}

func indexColumns(cols []database.ColumnInfo) map[string]database.ColumnInfo {
	by := make(map[string]database.ColumnInfo, len(cols))
	for _, c := range cols {
		by[c.Name] = c
	}
	return by
}
