//go:build e2e

package app

import (
	"fmt"
	"regexp"
	"strings"
	"testing"

	"xensql/internal/database"
)

// Word-bounded, so the fixture's own explain_* table name isn't mistaken for the keyword.
var explainKeywordRe = regexp.MustCompile(`(?i)\bexplain\b`)

// An indexed table with rows, so the planner has a choice to make.
func explainFixture(t *testing.T, a *App, e engine, connID string) string {
	t.Helper()
	table := uniqueTable("explain")
	createTempTable(t, a, e, connID, e.autoPKTable(table), table)
	mustExec(t, a, connID, fmt.Sprintf("CREATE INDEX %s_name ON %s (name)",
		strings.ReplaceAll(table, ".", "_"), qualified(e, table)))
	for _, name := range []string{"alpha", "beta", "gamma", "delta"} {
		mustExec(t, a, connID, fmt.Sprintf("INSERT INTO %s (name) VALUES ('%s')", qualified(e, table), name))
	}
	return table
}

func countNodes(nodes []database.PlanNode) int {
	total := 0
	for _, n := range nodes {
		total += 1 + countNodes(n.Children)
	}
	return total
}

func findNode(nodes []database.PlanNode, match func(database.PlanNode) bool) (database.PlanNode, bool) {
	for _, n := range nodes {
		if match(n) {
			return n, true
		}
		if found, ok := findNode(n.Children, match); ok {
			return found, true
		}
	}
	return database.PlanNode{}, false
}

func anyNode(nodes []database.PlanNode, match func(database.PlanNode) bool) bool {
	_, ok := findNode(nodes, match)
	return ok
}

func TestE2EExplainPlanOnly(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := explainFixture(t, a, e, connID)

		plan, err := a.ExplainQuery(connID, "", "SELECT * FROM "+qualified(e, table)+" WHERE name = 'beta'", false)
		if err != nil {
			t.Fatalf("explain: %v", err)
		}
		if plan.Analyzed {
			t.Error("a plan-only run must not report itself as analyzed")
		}
		if len(plan.Nodes) == 0 {
			t.Fatal("expected at least one plan node")
		}
		if plan.Raw == "" {
			t.Error("expected the engine's raw output to be kept")
		}
		if !anyNode(plan.Nodes, func(n database.PlanNode) bool { return n.CostTotal != nil }) {
			t.Errorf("no node carried a cost estimate: %+v", plan.Nodes)
		}
		if !anyNode(plan.Nodes, func(n database.PlanNode) bool { return n.RowsPlanned != nil }) {
			t.Errorf("no node carried a row estimate: %+v", plan.Nodes)
		}
		// Nothing ran.
		if anyNode(plan.Nodes, func(n database.PlanNode) bool { return n.RowsActual != nil || n.TimeMs != nil }) {
			t.Error("a plan-only run reported measured values")
		}
		if len(plan.Notes) != 0 {
			t.Errorf("expected no notes, got %v", plan.Notes)
		}
	})
}

func TestE2EExplainAnalyzeMeasures(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := explainFixture(t, a, e, connID)

		plan, err := a.ExplainQuery(connID, "", "SELECT * FROM "+qualified(e, table), true)
		if err != nil {
			t.Fatalf("explain analyze: %v", err)
		}
		if !plan.Analyzed {
			t.Error("expected the plan to report itself as analyzed")
		}
		if !anyNode(plan.Nodes, func(n database.PlanNode) bool { return n.RowsActual != nil }) {
			t.Errorf("no node carried measured rows: %+v", plan.Nodes)
		}
		if !anyNode(plan.Nodes, func(n database.PlanNode) bool { return n.TimeMs != nil }) {
			t.Errorf("no node carried a measured time: %+v", plan.Nodes)
		}
		// Self time drives the heat map, so it must be derivable everywhere.
		if !anyNode(plan.Nodes, func(n database.PlanNode) bool { return n.SelfTimeMs != nil }) {
			t.Errorf("no node carried a self time: %+v", plan.Nodes)
		}
	})
}

func TestE2EExplainAnalyzeRowCountsAreTotals(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := explainFixture(t, a, e, connID)

		plan, err := a.ExplainQuery(connID, "", "SELECT * FROM "+qualified(e, table), true)
		if err != nil {
			t.Fatalf("explain analyze: %v", err)
		}
		if !anyNode(plan.Nodes, func(n database.PlanNode) bool { return n.RowsActual != nil && *n.RowsActual == 4 }) {
			t.Errorf("expected a node reporting the 4 rows scanned: %s", planSummary(plan))
		}
	})
}

func TestE2EExplainIndexIsNamed(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := explainFixture(t, a, e, connID)
		plan, err := a.ExplainQuery(connID, "", "SELECT * FROM "+qualified(e, table)+" WHERE id = 1", false)
		if err != nil {
			t.Fatalf("explain: %v", err)
		}
		if !anyNode(plan.Nodes, func(n database.PlanNode) bool { return n.Index != "" }) {
			t.Errorf("expected some node to name the index it used: %s", planSummary(plan))
		}
	})
}

func TestE2EExplainAnalyzeRollsBackWrites(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := explainFixture(t, a, e, connID)

		plan, err := a.ExplainQuery(connID, "", "DELETE FROM "+qualified(e, table), true)
		if err != nil {
			t.Fatalf("explain analyze delete: %v", err)
		}
		if !planHasNote(plan, database.PlanNoteRolledBack) {
			t.Errorf("expected the rolled-back note, got %v", plan.Notes)
		}

		result, err := a.ExecuteQuery(connID, "SELECT COUNT(*) FROM "+qualified(e, table))
		if err != nil {
			t.Fatalf("count: %v", err)
		}
		if got := countValue(t, result); got != 4 {
			t.Fatalf("EXPLAIN ANALYZE of a DELETE left %d of 4 rows behind", got)
		}
	})
}

func TestE2EExplainWriteWithoutAnalyzeKeepsRows(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := explainFixture(t, a, e, connID)

		if _, err := a.ExplainQuery(connID, "", "DELETE FROM "+qualified(e, table), false); err != nil {
			t.Fatalf("explain delete: %v", err)
		}
		result, err := a.ExecuteQuery(connID, "SELECT COUNT(*) FROM "+qualified(e, table))
		if err != nil {
			t.Fatalf("count: %v", err)
		}
		if got := countValue(t, result); got != 4 {
			t.Fatalf("EXPLAIN of a DELETE left %d of 4 rows behind", got)
		}
	})
}

func TestE2EExplainOfAnExplain(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := explainFixture(t, a, e, connID)

		plan, err := a.ExplainQuery(connID, "", "EXPLAIN SELECT * FROM "+qualified(e, table), false)
		if err != nil {
			t.Fatalf("explain of an explain: %v", err)
		}
		if len(plan.Nodes) == 0 {
			t.Fatal("expected a plan for the underlying statement")
		}
		if got := len(explainKeywordRe.FindAllString(plan.ExplainSQL, -1)); got != 1 {
			t.Errorf("explain sql nests %d EXPLAINs: %q", got, plan.ExplainSQL)
		}
	})
}

func TestE2EExplainReportsSyntaxErrors(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		if _, err := a.ExplainQuery(connID, "", "SELECT * FROM table_that_is_not_there_xensql", false); err == nil {
			t.Fatal("expected an error for a missing table")
		}
	})
}

func TestE2EExplainPostgresTimings(t *testing.T) {
	a := appForTest(t)
	e := pgEngine()
	connID := requireEngine(t, a, e)
	table := explainFixture(t, a, e, connID)

	plan, err := a.ExplainQuery(connID, "", "SELECT * FROM "+qualified(e, table), true)
	if err != nil {
		t.Fatalf("explain analyze: %v", err)
	}
	if plan.PlanningMs == nil || *plan.PlanningMs <= 0 {
		t.Errorf("planning time = %v", plan.PlanningMs)
	}
	if plan.ExecutionMs == nil || *plan.ExecutionMs <= 0 {
		t.Errorf("execution time = %v", plan.ExecutionMs)
	}
	if plan.TotalCost == nil {
		t.Error("expected a total cost")
	}
}

func TestE2EExplainTreeHasDepth(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := explainFixture(t, a, e, connID)
		ref := qualified(e, table)
		query := fmt.Sprintf(
			"SELECT a.name FROM %s a JOIN %s b ON a.id = b.id JOIN %s c ON b.id = c.id ORDER BY a.name",
			ref, ref, ref)

		plan, err := a.ExplainQuery(connID, "", query, false)
		if err != nil {
			t.Fatalf("explain join: %v", err)
		}
		if got := countNodes(plan.Nodes); got < 3 {
			t.Errorf("expected a multi-node tree for a 3-way join, got %d: %s", got, planSummary(plan))
		}
		if !anyNode(plan.Nodes, func(n database.PlanNode) bool { return len(n.Children) > 0 }) {
			t.Errorf("plan tree is flat: %s", planSummary(plan))
		}
	})
}

func TestE2EExplainReadOnlyConnection(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := explainFixture(t, a, e, connID)

		cfg, err := a.getConnection(connID)
		if err != nil {
			t.Fatalf("get connection: %v", err)
		}
		cfg.ReadOnly = true
		if _, err := a.SaveConnection(cfg); err != nil {
			t.Fatalf("mark read-only: %v", err)
		}
		a.Disconnect(connID)

		if _, err := a.ExplainQuery(connID, "", "SELECT * FROM "+qualified(e, table), false); err != nil {
			t.Fatalf("planning a read on a read-only connection should work: %v", err)
		}
		if _, err := a.ExplainQuery(connID, "", "DELETE FROM "+qualified(e, table), true); err == nil {
			t.Fatal("expected a read-only error for a measured plan of a delete")
		}
	})
}

func planHasNote(plan *database.QueryPlan, code string) bool {
	for _, n := range plan.Notes {
		if n == code {
			return true
		}
	}
	return false
}

func planSummary(plan *database.QueryPlan) string {
	var b strings.Builder
	fmt.Fprintf(&b, "\n%s\n", plan.ExplainSQL)
	writePlanNodes(&b, plan.Nodes, 0)
	return b.String()
}

func writePlanNodes(b *strings.Builder, nodes []database.PlanNode, depth int) {
	for _, n := range nodes {
		fmt.Fprintf(b, "%s%s relation=%q index=%q cost=%s rows=%s actual=%s time=%s\n",
			strings.Repeat("  ", depth), n.Label, n.Relation, n.Index,
			floatOrDash(n.CostTotal), floatOrDash(n.RowsPlanned), floatOrDash(n.RowsActual), floatOrDash(n.TimeMs))
		writePlanNodes(b, n.Children, depth+1)
	}
}

func floatOrDash(v *float64) string {
	if v == nil {
		return "-"
	}
	return fmt.Sprintf("%g", *v)
}

// Drivers hand a COUNT(*) back as int64, or as a string when it would lose precision in JS.
func countValue(t *testing.T, result *database.QueryResult) int64 {
	t.Helper()
	if result == nil || len(result.Rows) == 0 || len(result.Rows[0]) == 0 {
		t.Fatal("count returned no rows")
	}
	switch v := result.Rows[0][0].(type) {
	case int64:
		return v
	case float64:
		return int64(v)
	case string:
		var n int64
		if _, err := fmt.Sscanf(v, "%d", &n); err != nil {
			t.Fatalf("count value %q: %v", v, err)
		}
		return n
	default:
		t.Fatalf("unexpected count type %T", v)
		return 0
	}
}
