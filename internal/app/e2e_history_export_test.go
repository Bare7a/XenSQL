//go:build e2e

package app

import (
	"strings"
	"testing"
)

// TestE2EQueryHistory checks that ExecuteQuery records per-connection history with
// success/error state and that history can be cleared - the Query History panel.
func TestE2EQueryHistory(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		// Clear any history left by other subtests on this fresh app+connection.
		if err := a.ClearQueryHistory(connID); err != nil {
			t.Fatalf("clear: %v", err)
		}

		if _, err := a.ExecuteQuery(connID, "SELECT 1"); err != nil {
			t.Fatalf("good query: %v", err)
		}
		// A failing query should still be recorded, marked unsuccessful.
		_, _ = a.ExecuteQuery(connID, "SELECT * FROM nope_history_table")

		entries := a.GetQueryHistory(connID, 10)
		if len(entries) < 2 {
			t.Fatalf("expected at least 2 history entries, got %d", len(entries))
		}
		var sawGood, sawBad bool
		for _, h := range entries {
			if h.SQL == "SELECT 1" && h.Success {
				sawGood = true
			}
			if strings.Contains(h.SQL, "nope_history_table") && !h.Success && h.Error != "" {
				sawBad = true
			}
		}
		if !sawGood {
			t.Error("successful query not recorded in history")
		}
		if !sawBad {
			t.Error("failed query not recorded as unsuccessful with an error")
		}

		if err := a.ClearQueryHistory(connID); err != nil {
			t.Fatalf("clear: %v", err)
		}
		if n := len(a.GetQueryHistory(connID, 10)); n != 0 {
			t.Errorf("history should be empty after clear, got %d", n)
		}
	})
}

// TestE2EExport runs a real query and exports the result through every supported
// format, checking the export reflects the live data.
func TestE2EExport(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := uniqueTable("export")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)
		mustExec(t, a, connID, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('alice')")
		mustExec(t, a, connID, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('bob')")

		res, err := a.ExecuteQuery(connID, "SELECT id, name FROM "+qualified(e, table)+" ORDER BY id")
		if err != nil {
			t.Fatalf("select: %v", err)
		}
		// ExportResult takes a value, not a pointer; mirror the Wails binding.
		result := *res

		cases := map[string][]string{
			"csv":      {"id,name", "alice", "bob"},
			"json":     {`"name": "alice"`, `"name": "bob"`},
			"markdown": {"| id | name |", "| --- | --- |", "alice"},
			"sql":      {"INSERT INTO", "'alice'", "'bob'"},
		}
		for format, wants := range cases {
			out, err := a.ExportResult(result, format)
			if err != nil {
				t.Fatalf("export %s: %v", format, err)
			}
			for _, want := range wants {
				if !strings.Contains(out, want) {
					t.Errorf("export %s missing %q in:\n%s", format, want, out)
				}
			}
		}

		if _, err := a.ExportResult(result, "not-a-format"); err == nil {
			t.Error("exporting an unknown format should fail")
		}
	})
}
