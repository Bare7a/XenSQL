//go:build e2e

package app

import (
	"strings"
	"testing"

	"xensql/internal/database"
)

// TestE2EQueryLifecycle drives ExecuteQuery - the single-statement path behind
// "Run selection" - through a full CREATE / INSERT / SELECT / UPDATE / DELETE
// cycle and checks the QueryResult shape the grid renders.
func TestE2EQueryLifecycle(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := uniqueTable("widgets")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)

		ins, err := a.ExecuteQuery(connID, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('alpha')")
		if err != nil {
			t.Fatalf("insert: %v", err)
		}
		if ins.AffectedRows != 1 {
			t.Errorf("insert AffectedRows = %d, want 1", ins.AffectedRows)
		}
		mustExec(t, a, connID, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('beta')")

		sel, err := a.ExecuteQuery(connID, "SELECT id, name FROM "+qualified(e, table)+" ORDER BY id")
		if err != nil {
			t.Fatalf("select: %v", err)
		}
		if sel.RowCount != 2 {
			t.Fatalf("select RowCount = %d, want 2 (%+v)", sel.RowCount, sel.Rows)
		}
		if len(sel.Columns) != 2 || sel.Columns[1] != "name" {
			t.Fatalf("unexpected columns %+v", sel.Columns)
		}
		// Column types must be populated so the grid can format cells.
		if len(sel.ColumnTypes) != 2 || sel.ColumnTypes[0] == "" {
			t.Errorf("expected populated ColumnTypes, got %+v", sel.ColumnTypes)
		}
		if sel.Rows[0][1] != "alpha" || sel.Rows[1][1] != "beta" {
			t.Fatalf("unexpected rows %+v", sel.Rows)
		}

		upd, err := a.ExecuteQuery(connID, "UPDATE "+qualified(e, table)+" SET name = 'ALPHA' WHERE name = 'alpha'")
		if err != nil {
			t.Fatalf("update: %v", err)
		}
		if upd.AffectedRows != 1 {
			t.Errorf("update AffectedRows = %d, want 1", upd.AffectedRows)
		}

		del, err := a.ExecuteQuery(connID, "DELETE FROM "+qualified(e, table)+" WHERE name = 'beta'")
		if err != nil {
			t.Fatalf("delete: %v", err)
		}
		if del.AffectedRows != 1 {
			t.Errorf("delete AffectedRows = %d, want 1", del.AffectedRows)
		}

		final, err := a.ExecuteQuery(connID, "SELECT name FROM "+qualified(e, table))
		if err != nil {
			t.Fatalf("final select: %v", err)
		}
		if final.RowCount != 1 || final.Rows[0][0] != "ALPHA" {
			t.Fatalf("after update+delete expected one row 'ALPHA', got %+v", final.Rows)
		}
	})
}

// TestE2EEmptyResultSet checks a SELECT matching no rows still reports its columns
// (so the grid can render an empty, correctly-headed table).
func TestE2EEmptyResultSet(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := uniqueTable("empty")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)

		res, err := a.ExecuteQuery(connID, "SELECT id, name FROM "+qualified(e, table)+" WHERE 1 = 0")
		if err != nil {
			t.Fatalf("select: %v", err)
		}
		if res.RowCount != 0 || len(res.Rows) != 0 {
			t.Fatalf("expected zero rows, got %+v", res.Rows)
		}
		if len(res.Columns) != 2 {
			t.Fatalf("expected 2 columns even with no rows, got %+v", res.Columns)
		}
	})
}

// TestE2EErrorSurfacing checks that DB errors (syntax, missing relation) flow back
// as Go errors rather than being swallowed.
func TestE2EErrorSurfacing(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		if _, err := a.ExecuteQuery(connID, "SELECT * FROM definitely_not_a_real_table_xyz"); err == nil {
			t.Error("expected error selecting a missing table")
		}
		if _, err := a.ExecuteQuery(connID, "SELCT 1"); err == nil {
			t.Error("expected error for invalid SQL")
		}
	})
}

// TestE2EValueNormalization checks the type coercions that protect the frontend:
// integers past JS's safe range become strings, NULL becomes nil, and binary is
// hex-encoded. Timestamps and JSON are checked per-driver where syntax differs.
func TestE2EValueNormalization(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		// 9007199254740993 = 2^53 + 1, the first integer JS float64 can't represent.
		res, err := a.ExecuteQuery(connID, "SELECT 'hi' AS t, 9007199254740993 AS big, NULL AS n")
		if err != nil {
			t.Fatalf("select: %v", err)
		}
		row := res.Rows[0]
		if row[0] != "hi" {
			t.Errorf("text col = %#v, want \"hi\"", row[0])
		}
		if s, ok := row[1].(string); !ok || s != "9007199254740993" {
			t.Errorf("bigint past 2^53 should be a string, got %#v", row[1])
		}
		if row[2] != nil {
			t.Errorf("NULL should normalize to nil, got %#v", row[2])
		}

		switch e.driver {
		case database.DriverPostgres:
			r, err := a.ExecuteQuery(connID,
				`SELECT '2021-06-07 08:09:10'::timestamp AS ts, '{"k": 1}'::jsonb AS j, decode('deadbeef','hex') AS b`)
			if err != nil {
				t.Fatalf("pg types: %v", err)
			}
			pr := r.Rows[0]
			if ts, _ := pr[0].(string); !strings.HasPrefix(ts, "2021-06-07T08:09:10") {
				t.Errorf("timestamp should be RFC3339, got %#v", pr[0])
			}
			if j, _ := pr[1].(string); !strings.Contains(j, "\"k\"") {
				t.Errorf("jsonb should come back as a JSON string, got %#v", pr[1])
			}
			if b, _ := pr[2].(string); b != `\xdeadbeef` {
				t.Errorf("bytea should be hex-encoded, got %#v", pr[2])
			}
		case database.DriverMySQL:
			r, err := a.ExecuteQuery(connID,
				`SELECT CAST('2021-06-07 08:09:10' AS DATETIME) AS ts, UNHEX('deadbeef') AS b`)
			if err != nil {
				t.Fatalf("mysql types: %v", err)
			}
			mr := r.Rows[0]
			if ts, _ := mr[0].(string); !strings.HasPrefix(ts, "2021-06-07T08:09:10") {
				t.Errorf("datetime should be RFC3339, got %#v", mr[0])
			}
			if b, _ := mr[1].(string); b != `\xdeadbeef` {
				t.Errorf("binary should be hex-encoded, got %#v", mr[1])
			}
		}
	})
}

// TestE2EReturningClause checks the RETURNING flow (INSERT/UPDATE/DELETE that
// return rows route through the query path and surface those rows to the grid).
// RETURNING is a PostgreSQL feature; MySQL is covered by InsertRow's reselect.
func TestE2EReturningClause(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		if e.driver != database.DriverPostgres {
			t.Skipf("RETURNING not exercised for %s here (InsertRow reselect is covered in the grid test)", e.name)
		}
		table := uniqueTable("ret")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)

		res, err := a.ExecuteQuery(connID,
			"INSERT INTO "+qualified(e, table)+" (name) VALUES ('made') RETURNING id, name")
		if err != nil {
			t.Fatalf("insert returning: %v", err)
		}
		if res.RowCount != 1 {
			t.Fatalf("RETURNING should yield 1 row, got %d (%+v)", res.RowCount, res.Rows)
		}
		if res.Rows[0][1] != "made" {
			t.Errorf("RETURNING name = %#v, want \"made\"", res.Rows[0][1])
		}
	})
}
