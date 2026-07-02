//go:build e2e

package app

import (
	"testing"

	"xensql/internal/database"
)

func queryTable(t *testing.T, a *App, connID string, req database.TableDataRequest) (*database.QueryResult, error) {
	t.Helper()
	s, err := a.sessionFor(connID)
	if err != nil {
		t.Fatalf("session: %v", err)
	}
	return s.QueryTable(testCtx(), req)
}

// TestE2EQueryTable covers the Results Grid "browse table" path: pagination,
// sorting, filtering, and the primary-key metadata that decides whether the grid
// is editable.
func TestE2EQueryTable(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := uniqueTable("browse")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)
		for _, name := range []string{"a", "b", "c", "d", "e"} {
			mustExec(t, a, connID, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('"+name+"')")
		}

		t.Run("metadata", func(t *testing.T) {
			res, err := queryTable(t, a, connID, database.TableDataRequest{
				Schema: e.browseSchema, Table: table, Limit: 100,
			})
			if err != nil {
				t.Fatalf("QueryTable: %v", err)
			}
			if res.RowCount != 5 {
				t.Errorf("RowCount = %d, want 5", res.RowCount)
			}
			if res.TableName != table {
				t.Errorf("TableName = %q, want %q", res.TableName, table)
			}
			if len(res.PrimaryKeys) != 1 || res.PrimaryKeys[0] != "id" {
				t.Errorf("PrimaryKeys = %+v, want [id]", res.PrimaryKeys)
			}
		})

		t.Run("pagination", func(t *testing.T) {
			page, err := queryTable(t, a, connID, database.TableDataRequest{
				Schema: e.browseSchema, Table: table, Limit: 2, Offset: 1, OrderBy: "id", OrderDir: "ASC",
			})
			if err != nil {
				t.Fatalf("QueryTable page: %v", err)
			}
			if page.RowCount != 2 {
				t.Fatalf("expected 2 rows, got %d", page.RowCount)
			}
			// Offset 1 over a,b,c,d,e ordered by id -> b,c.
			if page.Rows[0][1] != "b" || page.Rows[1][1] != "c" {
				t.Errorf("pagination window = %+v, want [b c]", [...]any{page.Rows[0][1], page.Rows[1][1]})
			}
		})

		t.Run("sort_desc", func(t *testing.T) {
			res, err := queryTable(t, a, connID, database.TableDataRequest{
				Schema: e.browseSchema, Table: table, Limit: 100, OrderBy: "name", OrderDir: "DESC",
			})
			if err != nil {
				t.Fatalf("QueryTable sort: %v", err)
			}
			if res.Rows[0][1] != "e" {
				t.Errorf("first row under name DESC = %#v, want \"e\"", res.Rows[0][1])
			}
		})

		t.Run("filter", func(t *testing.T) {
			res, err := queryTable(t, a, connID, database.TableDataRequest{
				Schema: e.browseSchema, Table: table, Limit: 100, Filter: "name = 'c'",
			})
			if err != nil {
				t.Fatalf("QueryTable filter: %v", err)
			}
			if res.RowCount != 1 || res.Rows[0][1] != "c" {
				t.Errorf("filter result = %+v, want one row 'c'", res.Rows)
			}
		})

		t.Run("malicious_filter_rejected", func(t *testing.T) {
			_, err := queryTable(t, a, connID, database.TableDataRequest{
				Schema: e.browseSchema, Table: table, Limit: 100, Filter: "1=1; DROP TABLE " + table,
			})
			if err == nil {
				t.Error("filter containing ';' should be rejected")
			}
		})
	})
}

// TestE2EGridEditing covers the no-SQL editing flow: InsertRow (which returns the
// full row including the generated key), UpdateRow, and DeleteRows.
func TestE2EGridEditing(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := uniqueTable("edit")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)

		// Insert: the generated id must come back so the grid can address the new row.
		row, err := a.InsertRow(connID, e.browseSchema, table, map[string]any{"name": "first"})
		if err != nil {
			t.Fatalf("InsertRow: %v", err)
		}
		if row["name"] != "first" {
			t.Errorf("InsertRow returned name = %#v, want \"first\"", row["name"])
		}
		idVal, ok := row["id"]
		if !ok || idVal == nil {
			t.Fatalf("InsertRow should return the generated id, got %+v", row)
		}

		// Update by primary key.
		if err := a.UpdateRow(connID, database.RowUpdate{
			Schema:     e.browseSchema,
			Table:      table,
			PrimaryKey: map[string]any{"id": idVal},
			Changes:    map[string]any{"name": "edited"},
		}); err != nil {
			t.Fatalf("UpdateRow: %v", err)
		}
		check, err := a.ExecuteQuery(connID, "SELECT name FROM "+qualified(e, table))
		if err != nil {
			t.Fatalf("verify update: %v", err)
		}
		if check.RowCount != 1 || check.Rows[0][0] != "edited" {
			t.Fatalf("after update expected one row 'edited', got %+v", check.Rows)
		}

		// Delete by primary key.
		n, err := a.DeleteRows(connID, database.RowDelete{
			Schema:      e.browseSchema,
			Table:       table,
			PrimaryKeys: []map[string]any{{"id": idVal}},
		})
		if err != nil {
			t.Fatalf("DeleteRows: %v", err)
		}
		if n != 1 {
			t.Errorf("DeleteRows returned %d, want 1", n)
		}
		after, err := a.ExecuteQuery(connID, "SELECT count(*) FROM "+qualified(e, table))
		if err != nil {
			t.Fatalf("verify delete: %v", err)
		}
		if cnt := asInt64(after.Rows[0][0]); cnt != 0 {
			t.Errorf("table should be empty after delete, count = %d", cnt)
		}
	})
}

// TestE2EUpdateRequiresPrimaryKey checks the safety rule that edits are refused on
// a table with no primary key (no WHERE target -> can't address a single row).
func TestE2EUpdateRequiresPrimaryKey(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := uniqueTable("nopk")
		createTempTable(t, a, e, connID,
			"CREATE TABLE "+qualified(e, table)+" (a INT, b VARCHAR(50))", table)
		mustExec(t, a, connID, "INSERT INTO "+qualified(e, table)+" (a, b) VALUES (1, 'x')")

		err := a.UpdateRow(connID, database.RowUpdate{
			Schema:     e.browseSchema,
			Table:      table,
			PrimaryKey: map[string]any{"a": 1},
			Changes:    map[string]any{"b": "y"},
		})
		if err == nil {
			t.Error("UpdateRow on a table without a primary key should fail")
		}
	})
}

// asInt64 coerces the various integer representations the drivers return for
// count(*) (int64, or a string for huge values) into an int64.
func asInt64(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int32:
		return int64(n)
	case int:
		return int64(n)
	default:
		return -1
	}
}
