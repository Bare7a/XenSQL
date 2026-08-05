package database

import (
	"math"
	"strings"
	"testing"
)

func TestParseServerVersion(t *testing.T) {
	tests := []struct {
		raw     string
		mariaDB bool
		major   int
		minor   int
		patch   int
	}{
		{"8.0.36", false, 8, 0, 36},
		{"8.0.18-log", false, 8, 0, 18},
		{"9.1.0", false, 9, 1, 0},
		{"5.7.44-log", false, 5, 7, 44},
		{"11.4.2-MariaDB-ubu2404", true, 11, 4, 2},
		{"5.5.5-10.6.12-MariaDB-1:10.6.12+maria~ubu2004", true, 10, 6, 12},
		{"", false, 0, 0, 0},
	}
	for _, tc := range tests {
		got := ParseServerVersion(tc.raw)
		if got.MariaDB != tc.mariaDB || got.Major != tc.major || got.Minor != tc.minor || got.Patch != tc.patch {
			t.Errorf("ParseServerVersion(%q) = %+v, want mariadb=%v %d.%d.%d",
				tc.raw, got, tc.mariaDB, tc.major, tc.minor, tc.patch)
		}
	}
}

func TestServerVersionAtLeast(t *testing.T) {
	tests := []struct {
		raw  string
		want bool
	}{
		{"8.0.18", true},
		{"8.0.36", true},
		{"8.4.0", true},
		{"9.0.0", true},
		{"8.0.17", false},
		{"5.7.44", false},
		{"8.0.2", false},
	}
	for _, tc := range tests {
		if got := ParseServerVersion(tc.raw).atLeast(8, 0, 18); got != tc.want {
			t.Errorf("%s atLeast(8.0.18) = %v, want %v", tc.raw, got, tc.want)
		}
	}
}

func TestBuildExplainSQL(t *testing.T) {
	mysql8 := ParseServerVersion("8.0.36")
	mysql57 := ParseServerVersion("5.7.44")
	maria := ParseServerVersion("11.4.2-MariaDB")

	tests := []struct {
		name    string
		driver  DriverType
		sv      ServerVersion
		stmt    string
		analyze bool
		want    string
		wantErr bool
	}{
		{name: "postgres plan", driver: DriverPostgres, stmt: "SELECT 1", want: "EXPLAIN (FORMAT JSON) SELECT 1"},
		{
			name: "postgres analyze", driver: DriverPostgres, stmt: "SELECT 1", analyze: true,
			want: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT 1",
		},
		{name: "mysql plan", driver: DriverMySQL, sv: mysql8, stmt: "SELECT 1", want: "EXPLAIN FORMAT=JSON SELECT 1"},
		{
			name: "mysql analyze uses tree", driver: DriverMySQL, sv: mysql8, stmt: "SELECT 1", analyze: true,
			want: "EXPLAIN ANALYZE SELECT 1",
		},
		{
			name: "mariadb analyze", driver: DriverMySQL, sv: maria, stmt: "SELECT 1", analyze: true,
			want: "ANALYZE FORMAT=JSON SELECT 1",
		},
		{name: "mysql 5.7 cannot analyze", driver: DriverMySQL, sv: mysql57, stmt: "SELECT 1", analyze: true, wantErr: true},
		{name: "sqlite plan", driver: DriverSQLite, stmt: "SELECT 1", want: "EXPLAIN QUERY PLAN SELECT 1"},
		{name: "sqlite cannot analyze", driver: DriverSQLite, stmt: "SELECT 1", analyze: true, wantErr: true},
		{name: "empty statement", driver: DriverPostgres, stmt: "   ", wantErr: true},
		{name: "unknown driver", driver: DriverType("oracle"), stmt: "SELECT 1", wantErr: true},
		{
			name: "trailing semicolon dropped", driver: DriverPostgres, stmt: "SELECT 1;  ",
			want: "EXPLAIN (FORMAT JSON) SELECT 1",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := BuildExplainSQL(tc.driver, tc.sv, tc.stmt, tc.analyze)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

// A typed EXPLAIN is replaced, not nested.
func TestBuildExplainSQLStripsExistingExplain(t *testing.T) {
	tests := []struct {
		driver DriverType
		stmt   string
		want   string
	}{
		{DriverPostgres, "EXPLAIN SELECT 1", "EXPLAIN (FORMAT JSON) SELECT 1"},
		{DriverPostgres, "EXPLAIN ANALYZE SELECT 1", "EXPLAIN (FORMAT JSON) SELECT 1"},
		{DriverPostgres, "explain (analyze, buffers) select 1", "EXPLAIN (FORMAT JSON) select 1"},
		{DriverPostgres, "EXPLAIN (FORMAT TEXT) WITH x AS (SELECT 1) SELECT * FROM x", "EXPLAIN (FORMAT JSON) WITH x AS (SELECT 1) SELECT * FROM x"},
		{DriverMySQL, "EXPLAIN FORMAT=JSON SELECT 1", "EXPLAIN FORMAT=JSON SELECT 1"},
		{DriverMySQL, "EXPLAIN ANALYZE SELECT 1", "EXPLAIN FORMAT=JSON SELECT 1"},
		{DriverMySQL, "ANALYZE FORMAT=JSON SELECT 1", "EXPLAIN FORMAT=JSON SELECT 1"},
		{DriverSQLite, "EXPLAIN QUERY PLAN SELECT 1", "EXPLAIN QUERY PLAN SELECT 1"},
		// Not an explain of a statement: left alone.
		{DriverMySQL, "ANALYZE TABLE t", "EXPLAIN FORMAT=JSON ANALYZE TABLE t"},
		{DriverPostgres, "EXPLAIN", "EXPLAIN (FORMAT JSON) EXPLAIN"},
	}
	for _, tc := range tests {
		got, err := BuildExplainSQL(tc.driver, ServerVersion{}, tc.stmt, false)
		if err != nil {
			t.Fatalf("%s %q: %v", tc.driver, tc.stmt, err)
		}
		if got != tc.want {
			t.Errorf("%s %q: got %q, want %q", tc.driver, tc.stmt, got, tc.want)
		}
	}
}

func TestSingleStatement(t *testing.T) {
	if got, err := SingleStatement(DriverPostgres, " SELECT 1; "); err != nil || got != "SELECT 1" {
		t.Errorf("single: got %q, %v", got, err)
	}
	if _, err := SingleStatement(DriverPostgres, "SELECT 1; SELECT 2"); err == nil {
		t.Error("expected an error for two statements")
	}
	if _, err := SingleStatement(DriverPostgres, "  -- just a comment\n"); err == nil {
		t.Error("expected an error for no statement")
	}
}

// ---------- Postgres ----------

const pgAnalyzeJSON = `[
  {
    "Plan": {
      "Node Type": "Nested Loop",
      "Parallel Aware": false,
      "Join Type": "Inner",
      "Startup Cost": 0.29,
      "Total Cost": 42.58,
      "Plan Rows": 10,
      "Plan Width": 68,
      "Actual Startup Time": 0.021,
      "Actual Total Time": 0.185,
      "Actual Rows": 9,
      "Actual Loops": 1,
      "Plans": [
        {
          "Node Type": "Seq Scan",
          "Parent Relationship": "Outer",
          "Relation Name": "orders",
          "Alias": "o",
          "Startup Cost": 0.00,
          "Total Cost": 18.10,
          "Plan Rows": 10,
          "Plan Width": 36,
          "Actual Startup Time": 0.010,
          "Actual Total Time": 0.032,
          "Actual Rows": 9,
          "Actual Loops": 1,
          "Filter": "(total > 100)",
          "Rows Removed by Filter": 3,
          "Shared Hit Blocks": 5
        },
        {
          "Node Type": "Index Scan",
          "Parent Relationship": "Inner",
          "Relation Name": "customers",
          "Alias": "c",
          "Index Name": "customers_pkey",
          "Startup Cost": 0.29,
          "Total Cost": 2.44,
          "Plan Rows": 1,
          "Plan Width": 32,
          "Actual Startup Time": 0.003,
          "Actual Total Time": 0.004,
          "Actual Rows": 1,
          "Actual Loops": 9,
          "Index Cond": "(id = o.customer_id)"
        }
      ]
    },
    "Planning Time": 0.153,
    "Execution Time": 0.221
  }
]`

func TestParsePostgresAnalyzePlan(t *testing.T) {
	plan := parsePlanFixture(t, DriverPostgres, true, pgAnalyzeJSON)

	if len(plan.Nodes) != 1 {
		t.Fatalf("expected 1 root, got %d", len(plan.Nodes))
	}
	wantFloat(t, "planning ms", plan.PlanningMs, 0.153)
	wantFloat(t, "execution ms", plan.ExecutionMs, 0.221)
	wantFloat(t, "total cost", plan.TotalCost, 42.58)
	if plan.Notes != nil {
		t.Errorf("an analyzed plan needs no notes, got %v", plan.Notes)
	}

	root := plan.Nodes[0]
	if root.Label != "Nested Loop" {
		t.Errorf("root label = %q", root.Label)
	}
	wantFloat(t, "root time", root.TimeMs, 0.185)
	wantFloat(t, "root rows", root.RowsActual, 9)
	wantFloat(t, "root self time", root.SelfTimeMs, 0.185-(0.032+0.036))
	wantFloat(t, "root self cost", root.CostSelf, 42.58-(18.10+2.44))
	if len(root.Children) != 2 {
		t.Fatalf("expected 2 children, got %d", len(root.Children))
	}

	seq := root.Children[0]
	if seq.Label != "Seq Scan" || seq.Relation != "orders o" {
		t.Errorf("seq scan = %q on %q", seq.Label, seq.Relation)
	}
	if seq.Detail != "(total > 100)" {
		t.Errorf("seq scan detail = %q", seq.Detail)
	}
	wantFloat(t, "seq scan cost", seq.CostTotal, 18.10)
	wantFloat(t, "seq scan self cost", seq.CostSelf, 18.10)
	if hasField(seq.Fields, "Filter") {
		t.Error("the detail clause should not repeat in the field list")
	}
	if got := fieldValue(seq.Fields, "Rows Removed by Filter"); got != "3" {
		t.Errorf("rows removed by filter = %q", got)
	}
	if got := fieldValue(seq.Fields, "Shared Hit Blocks"); got != "5" {
		t.Errorf("shared hit blocks = %q", got)
	}

	idx := root.Children[1]
	if idx.Index != "customers_pkey" || idx.Detail != "(id = o.customer_id)" {
		t.Errorf("index scan = %+v", idx)
	}
	// Per-loop averages: 9 loops of 1 row at 0.004ms is 9 rows in 0.036ms.
	wantFloat(t, "index scan loops", idx.Loops, 9)
	wantFloat(t, "index scan rows", idx.RowsActual, 9)
	wantFloat(t, "index scan time", idx.TimeMs, 0.036)
}

func TestParsePostgresPlanOnly(t *testing.T) {
	const raw = `[{"Plan":{"Node Type":"Seq Scan","Relation Name":"t","Alias":"t","Total Cost":12.5,"Plan Rows":420,"Plan Width":8}}]`
	plan := parsePlanFixture(t, DriverPostgres, false, raw)

	root := plan.Nodes[0]
	if root.TimeMs != nil || root.RowsActual != nil || root.Loops != nil {
		t.Errorf("a plan-only run must carry no measurements: %+v", root)
	}
	wantFloat(t, "rows planned", root.RowsPlanned, 420)
	if len(plan.Notes) != 0 {
		t.Errorf("expected no notes, got %v", plan.Notes)
	}
}

func TestPostgresLabels(t *testing.T) {
	tests := []struct {
		raw  string
		want string
	}{
		{`{"Node Type":"Hash Join","Join Type":"Left"}`, "Hash Join (Left)"},
		{`{"Node Type":"Hash Join","Join Type":"Inner"}`, "Hash Join"},
		{`{"Node Type":"Aggregate","Strategy":"Hashed"}`, "Aggregate (Hashed)"},
		{`{"Node Type":"Aggregate","Strategy":"Plain"}`, "Aggregate"},
		{`{"Node Type":"Seq Scan","Parallel Aware":true}`, "Parallel Seq Scan"},
		{`{"Node Type":"Aggregate","Subplan Name":"InitPlan 1 (returns $0)"}`, "InitPlan 1 (returns $0): Aggregate"},
		{`{}`, "Node"},
	}
	for _, tc := range tests {
		plan := parsePlanFixture(t, DriverPostgres, false, `[{"Plan":`+tc.raw+`}]`)
		if got := plan.Nodes[0].Label; got != tc.want {
			t.Errorf("%s → %q, want %q", tc.raw, got, tc.want)
		}
	}
}

// A subplan's time is outside its parent's total, so the subtraction must not go negative.
func TestPostgresSelfTimeNeverNegative(t *testing.T) {
	const raw = `[{"Plan":{
		"Node Type":"Result","Total Cost":1.0,"Actual Total Time":0.05,"Actual Loops":1,
		"Plans":[{"Node Type":"Aggregate","Subplan Name":"InitPlan 1","Total Cost":9.0,"Actual Total Time":0.4,"Actual Loops":1}]
	}}]`
	plan := parsePlanFixture(t, DriverPostgres, true, raw)
	wantFloat(t, "self time", plan.Nodes[0].SelfTimeMs, 0)
	wantFloat(t, "self cost", plan.Nodes[0].CostSelf, 0)
}

func TestPostgresNeverExecuted(t *testing.T) {
	const raw = `[{"Plan":{"Node Type":"Result","Total Cost":1,"Actual Total Time":0,"Actual Rows":0,"Actual Loops":0}}]`
	plan := parsePlanFixture(t, DriverPostgres, true, raw)
	if !plan.Nodes[0].NeverRun {
		t.Error("expected the node to be marked as never run")
	}
}

func TestParsePostgresPlanRejectsGarbage(t *testing.T) {
	res := &QueryResult{Columns: []string{"QUERY PLAN"}, Rows: [][]any{{"not json"}}}
	if _, err := ParsePlan(DriverPostgres, "SELECT 1", "EXPLAIN …", false, res); err == nil {
		t.Fatal("expected an error for non-JSON output")
	}
}

// ---------- MySQL ----------

const mysqlJSON = `{
  "query_block": {
    "select_id": 1,
    "cost_info": {"query_cost": "3.60"},
    "nested_loop": [
      {
        "table": {
          "table_name": "o",
          "access_type": "ALL",
          "rows_examined_per_scan": 10,
          "rows_produced_per_join": 3,
          "filtered": "33.33",
          "cost_info": {"read_cost": "1.25", "eval_cost": "0.33", "prefix_cost": "1.58", "data_read_per_join": "160"},
          "used_columns": ["id", "customer_id", "total"],
          "attached_condition": "(` + "`shop`.`o`.`total`" + ` > 100)"
        }
      },
      {
        "table": {
          "table_name": "c",
          "access_type": "eq_ref",
          "possible_keys": ["PRIMARY"],
          "key": "PRIMARY",
          "used_key_parts": ["id"],
          "key_length": "4",
          "ref": ["shop.o.customer_id"],
          "rows_examined_per_scan": 1,
          "rows_produced_per_join": 3,
          "filtered": "100.00",
          "cost_info": {"read_cost": "1.69", "eval_cost": "0.33", "prefix_cost": "3.60", "data_read_per_join": "192"}
        }
      }
    ]
  }
}`

func TestParseMySQLJSONPlan(t *testing.T) {
	plan := parsePlanFixture(t, DriverMySQL, false, mysqlJSON)

	if len(plan.Nodes) != 1 {
		t.Fatalf("expected 1 root, got %d", len(plan.Nodes))
	}
	root := plan.Nodes[0]
	if root.Label != "Query block #1" {
		t.Errorf("root label = %q", root.Label)
	}
	wantFloat(t, "total cost", plan.TotalCost, 3.60)

	if len(root.Children) != 1 {
		t.Fatalf("expected the nested loop group, got %d children", len(root.Children))
	}
	group := root.Children[0]
	if group.Label != "Nested loop" {
		t.Errorf("group label = %q", group.Label)
	}
	// Sum of the tables' own costs, not of MySQL's cumulative prefix_cost.
	wantFloat(t, "join cost", group.CostTotal, 3.60)
	if len(group.Children) != 2 {
		t.Fatalf("expected 2 tables, got %d", len(group.Children))
	}

	outer := group.Children[0]
	if outer.Label != "Table (ALL)" || outer.Relation != "o" {
		t.Errorf("outer = %q on %q", outer.Label, outer.Relation)
	}
	if !strings.Contains(outer.Detail, "> 100") {
		t.Errorf("outer detail = %q", outer.Detail)
	}
	wantFloat(t, "outer rows", outer.RowsPlanned, 3)
	wantFloat(t, "outer self cost", outer.CostSelf, 1.58)
	// cost_info's other numbers survive the fold.
	if got := fieldValue(outer.Fields, "Prefix cost"); got != "1.58" {
		t.Errorf("prefix cost field = %q", got)
	}
	if got := fieldValue(outer.Fields, "Rows examined per scan"); got != "10" {
		t.Errorf("rows examined field = %q", got)
	}
	if got := fieldValue(outer.Fields, "Used columns"); got != "id, customer_id, total" {
		t.Errorf("used columns field = %q", got)
	}

	inner := group.Children[1]
	if inner.Label != "Table (eq_ref)" || inner.Index != "PRIMARY" {
		t.Errorf("inner = %q using %q", inner.Label, inner.Index)
	}
	wantFloat(t, "inner self cost", inner.CostSelf, 2.02)
	if inner.TimeMs != nil {
		t.Errorf("EXPLAIN without ANALYZE has no timings, got %v", *inner.TimeMs)
	}
}

const mariaAnalyzeJSON = `{
  "query_block": {
    "select_id": 1,
    "r_loops": 1,
    "r_total_time_ms": 0.4521,
    "nested_loop": [
      {
        "table": {
          "table_name": "o",
          "access_type": "ALL",
          "r_loops": 1,
          "rows": 10,
          "r_rows": 9,
          "r_table_time_ms": 0.0521,
          "r_other_time_ms": 0.0129,
          "filtered": 100,
          "r_filtered": 90,
          "attached_condition": "o.total > 100"
        }
      },
      {
        "table": {
          "table_name": "c",
          "access_type": "eq_ref",
          "possible_keys": ["PRIMARY"],
          "key": "PRIMARY",
          "r_loops": 9,
          "rows": 1,
          "r_rows": 1,
          "r_table_time_ms": 0.1521,
          "r_other_time_ms": 0.0221
        }
      }
    ]
  }
}`

func TestParseMariaDBAnalyzePlan(t *testing.T) {
	plan := parsePlanFixture(t, DriverMySQL, true, mariaAnalyzeJSON)

	root := plan.Nodes[0]
	wantFloat(t, "root time", root.TimeMs, 0.4521)
	wantFloat(t, "execution ms", plan.ExecutionMs, 0.4521)

	group := root.Children[0]
	outer := group.Children[0]
	// MariaDB splits table and other time; together they are the node's own.
	wantFloat(t, "outer self time", outer.SelfTimeMs, 0.065)
	wantFloat(t, "outer rows planned", outer.RowsPlanned, 10)
	wantFloat(t, "outer rows actual", outer.RowsActual, 9)

	inner := group.Children[1]
	wantFloat(t, "inner loops", inner.Loops, 9)
	wantFloat(t, "inner rows actual", inner.RowsActual, 9)
	wantFloat(t, "inner self time", inner.SelfTimeMs, 0.1742)

	wantFloat(t, "join time", group.TimeMs, 0.065+0.1742)
	wantFloat(t, "root self time", root.SelfTimeMs, 0.4521-(0.065+0.1742))
}

const mysqlTree = `-> Nested loop inner join  (cost=3.60 rows=3) (actual time=0.0451..0.0912 rows=9 loops=1)
    -> Filter: (o.total > 100)  (cost=1.58 rows=3) (actual time=0.0312..0.0451 rows=9 loops=1)
        -> Table scan on o  (cost=1.58 rows=10) (actual time=0.0221..0.0356 rows=10 loops=1)
    -> Single-row index lookup on c using PRIMARY (id=o.customer_id)  (cost=0.67 rows=1) (actual time=0.0021..0.0024 rows=1 loops=9)
`

func TestParseMySQLTreePlan(t *testing.T) {
	plan := parsePlanFixture(t, DriverMySQL, true, mysqlTree)

	if len(plan.Nodes) != 1 {
		t.Fatalf("expected 1 root, got %d", len(plan.Nodes))
	}
	root := plan.Nodes[0]
	if root.Label != "Nested loop inner join" {
		t.Errorf("root label = %q", root.Label)
	}
	wantFloat(t, "root cost", root.CostTotal, 3.60)
	wantFloat(t, "root rows planned", root.RowsPlanned, 3)
	wantFloat(t, "root time", root.TimeMs, 0.0912)
	wantFloat(t, "root rows actual", root.RowsActual, 9)
	if len(root.Children) != 2 {
		t.Fatalf("expected 2 children, got %d", len(root.Children))
	}

	filter := root.Children[0]
	if filter.Label != "Filter" || filter.Detail != "(o.total > 100)" {
		t.Errorf("filter = %q / %q", filter.Label, filter.Detail)
	}
	if len(filter.Children) != 1 {
		t.Fatalf("expected the scan under the filter, got %d children", len(filter.Children))
	}
	if scan := filter.Children[0]; scan.Relation != "o" {
		t.Errorf("scan relation = %q", scan.Relation)
	}

	lookup := root.Children[1]
	if lookup.Relation != "c" || lookup.Index != "PRIMARY" {
		t.Errorf("lookup = %q using %q", lookup.Relation, lookup.Index)
	}
	wantFloat(t, "lookup time", lookup.TimeMs, 0.0216)
	wantFloat(t, "lookup rows", lookup.RowsActual, 9)
	wantFloat(t, "root self time", root.SelfTimeMs, 0.0912-(0.0451+0.0216))
}

func TestParseMySQLTreeNeverExecuted(t *testing.T) {
	const raw = `-> Limit: 1 row(s)  (cost=0.35 rows=1) (actual time=0.01..0.02 rows=1 loops=1)
    -> Index lookup on t using ix (a=1)  (cost=0.35 rows=1) (never executed)
`
	plan := parsePlanFixture(t, DriverMySQL, true, raw)
	child := plan.Nodes[0].Children[0]
	if !child.NeverRun {
		t.Error("expected the child to be marked as never run")
	}
	if !strings.HasPrefix(child.Label, "Index lookup on t using ix") {
		t.Errorf("label kept the marker: %q", child.Label)
	}
}

func TestParseMySQLTreeIgnoresClauseKeywords(t *testing.T) {
	const raw = `-> Filter: (t.status = 'on' and t.mode = 'using idx')  (cost=1.0 rows=1)
`
	node := parsePlanFixture(t, DriverMySQL, false, raw).Nodes[0]
	if node.Relation != "" || node.Index != "" {
		t.Errorf("relation = %q, index = %q; both should be empty", node.Relation, node.Index)
	}
}

// ---------- SQLite ----------

func TestParseSQLitePlan(t *testing.T) {
	res := &QueryResult{
		Columns: []string{"id", "parent", "notused", "detail"},
		Rows: [][]any{
			{int64(4), int64(0), int64(0), "CO-ROUTINE t1"},
			{int64(8), int64(4), int64(0), "SCAN x"},
			{int64(20), int64(0), int64(0), "SEARCH c USING INDEX idx_c (a=?)"},
		},
	}
	plan, err := ParsePlan(DriverSQLite, "SELECT 1", "EXPLAIN QUERY PLAN SELECT 1", false, res)
	if err != nil {
		t.Fatalf("ParsePlan: %v", err)
	}
	if len(plan.Nodes) != 2 {
		t.Fatalf("expected 2 roots, got %d", len(plan.Nodes))
	}

	coroutine := plan.Nodes[0]
	if coroutine.Label != "CO-ROUTINE t1" {
		t.Errorf("coroutine label = %q", coroutine.Label)
	}
	if len(coroutine.Children) != 1 || coroutine.Children[0].Relation != "x" {
		t.Fatalf("expected SCAN x nested under the coroutine, got %+v", coroutine.Children)
	}
	if coroutine.Children[0].Label != "SCAN" {
		t.Errorf("child label = %q", coroutine.Children[0].Label)
	}

	search := plan.Nodes[1]
	if search.Label != "SEARCH" || search.Relation != "c" || search.Index != "idx_c" {
		t.Errorf("search = %+v", search)
	}
	if search.Detail != "USING INDEX idx_c (a=?)" {
		t.Errorf("search detail = %q", search.Detail)
	}
	if search.CostTotal != nil || search.RowsPlanned != nil || search.TimeMs != nil {
		t.Error("SQLite reports no cost, row or time estimates")
	}
	if !hasNote(plan, PlanNoteNoMetrics) {
		t.Errorf("expected the no-metrics note, got %v", plan.Notes)
	}
	if plan.Raw != "4|0|CO-ROUTINE t1\n8|4|SCAN x\n20|0|SEARCH c USING INDEX idx_c (a=?)" {
		t.Errorf("raw = %q", plan.Raw)
	}
}

func TestParseSQLiteScanVariants(t *testing.T) {
	tests := []struct {
		detail   string
		label    string
		relation string
		index    string
	}{
		{"SCAN t", "SCAN", "t", ""},
		{"SCAN TABLE t", "SCAN", "t", ""},
		{"SEARCH t USING COVERING INDEX ix_t (a=?)", "SEARCH", "t", "ix_t"},
		{"SEARCH t USING AUTOMATIC PARTIAL COVERING INDEX ix (a=?)", "SEARCH", "t", ""},
		{"SEARCH t USING INTEGER PRIMARY KEY (rowid=?)", "SEARCH", "t", ""},
		{"USE TEMP B-TREE FOR ORDER BY", "USE TEMP B-TREE FOR ORDER BY", "", ""},
	}
	for _, tc := range tests {
		got := sqliteNode(tc.detail)
		if got.Label != tc.label || got.Relation != tc.relation || got.Index != tc.index {
			t.Errorf("%q → label %q relation %q index %q; want %q/%q/%q",
				tc.detail, got.Label, got.Relation, got.Index, tc.label, tc.relation, tc.index)
		}
	}
}

func TestParsePlanRejectsEmptyResult(t *testing.T) {
	if _, err := ParsePlan(DriverPostgres, "SELECT 1", "EXPLAIN …", false, nil); err == nil {
		t.Error("expected an error for a nil result")
	}
	empty := &QueryResult{Columns: []string{"QUERY PLAN"}}
	if _, err := ParsePlan(DriverPostgres, "SELECT 1", "EXPLAIN …", false, empty); err == nil {
		t.Error("expected an error for a result with no rows")
	}
}

// ---------- helpers ----------

func parsePlanFixture(t *testing.T, driver DriverType, analyze bool, raw string) *QueryPlan {
	t.Helper()
	res := &QueryResult{Columns: []string{"EXPLAIN"}, Rows: [][]any{{raw}}}
	plan, err := ParsePlan(driver, "SELECT 1", "EXPLAIN …", analyze, res)
	if err != nil {
		t.Fatalf("ParsePlan(%s): %v", driver, err)
	}
	if len(plan.Nodes) == 0 {
		t.Fatalf("ParsePlan(%s) produced no nodes", driver)
	}
	return plan
}

func wantFloat(t *testing.T, what string, got *float64, want float64) {
	t.Helper()
	if got == nil {
		t.Errorf("%s is missing, want %g", what, want)
		return
	}
	if math.Abs(*got-want) > 1e-9 {
		t.Errorf("%s = %g, want %g", what, *got, want)
	}
}

func fieldValue(fields []PlanField, key string) string {
	for _, f := range fields {
		if f.Key == key {
			return f.Value
		}
	}
	return ""
}

func hasField(fields []PlanField, key string) bool {
	for _, f := range fields {
		if f.Key == key {
			return true
		}
	}
	return false
}

func hasNote(plan *QueryPlan, code string) bool {
	for _, n := range plan.Notes {
		if n == code {
			return true
		}
	}
	return false
}

// ---------- detecting a typed EXPLAIN ----------

func TestDetectPlanRequestPostgres(t *testing.T) {
	tests := []struct {
		stmt    string
		wantSQL string
		analyze bool
		wantOK  bool
	}{
		// Text output: asked again in JSON.
		{stmt: "EXPLAIN SELECT 1", wantSQL: "EXPLAIN (FORMAT JSON) SELECT 1", wantOK: true},
		{stmt: "EXPLAIN ANALYZE SELECT 1", wantSQL: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT 1", analyze: true, wantOK: true},
		{stmt: "explain analyze verbose select 1", wantSQL: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) select 1", analyze: true, wantOK: true},
		{stmt: "EXPLAIN (ANALYZE, BUFFERS) SELECT 1", wantSQL: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT 1", analyze: true, wantOK: true},
		// Already JSON: run as typed.
		{stmt: "EXPLAIN (FORMAT JSON) SELECT 1", wantSQL: "EXPLAIN (FORMAT JSON) SELECT 1", wantOK: true},
		{stmt: "EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1", wantSQL: "EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1", analyze: true, wantOK: true},
		{stmt: "EXPLAIN (ANALYZE false, FORMAT JSON) SELECT 1", wantSQL: "EXPLAIN (ANALYZE false, FORMAT JSON) SELECT 1", wantOK: true},
		// A named format means raw output.
		{stmt: "EXPLAIN (FORMAT TEXT) SELECT 1", wantOK: false},
		{stmt: "EXPLAIN (FORMAT YAML) SELECT 1", wantOK: false},
		{stmt: "EXPLAIN (ANALYZE, FORMAT XML) SELECT 1", wantOK: false},
		{stmt: "SELECT 1", wantOK: false},
		{stmt: "EXPLAIN", wantOK: false},
		{stmt: "ANALYZE my_table", wantOK: false},
		{stmt: "-- a comment\nEXPLAIN SELECT 1", wantSQL: "EXPLAIN (FORMAT JSON) SELECT 1", wantOK: true},
	}
	for _, tc := range tests {
		got, ok := DetectPlanRequest(DriverPostgres, tc.stmt)
		if ok != tc.wantOK {
			t.Errorf("DetectPlanRequest(%q) ok = %v, want %v", tc.stmt, ok, tc.wantOK)
			continue
		}
		if !ok {
			continue
		}
		if got.SQL != tc.wantSQL || got.Analyze != tc.analyze {
			t.Errorf("DetectPlanRequest(%q) = %q analyze=%v, want %q analyze=%v",
				tc.stmt, got.SQL, got.Analyze, tc.wantSQL, tc.analyze)
		}
	}
}

func TestDetectPlanRequestMySQL(t *testing.T) {
	tests := []struct {
		stmt    string
		wantSQL string
		analyze bool
		wantOK  bool
	}{
		// Traditional table: asked again in JSON.
		{stmt: "EXPLAIN SELECT 1", wantSQL: "EXPLAIN FORMAT=JSON SELECT 1", wantOK: true},
		// Tree output parses as-is.
		{stmt: "EXPLAIN ANALYZE SELECT 1", wantSQL: "EXPLAIN ANALYZE SELECT 1", analyze: true, wantOK: true},
		{stmt: "EXPLAIN FORMAT=JSON SELECT 1", wantSQL: "EXPLAIN FORMAT=JSON SELECT 1", wantOK: true},
		{stmt: "EXPLAIN FORMAT=TREE SELECT 1", wantSQL: "EXPLAIN FORMAT=TREE SELECT 1", wantOK: true},
		{stmt: "EXPLAIN ANALYZE FORMAT=JSON SELECT 1", wantSQL: "EXPLAIN ANALYZE FORMAT=JSON SELECT 1", analyze: true, wantOK: true},
		{stmt: "ANALYZE FORMAT=JSON SELECT 1", wantSQL: "ANALYZE FORMAT=JSON SELECT 1", analyze: true, wantOK: true},
		// Tabular: asked again in JSON, still measured.
		{stmt: "ANALYZE SELECT 1", wantSQL: "ANALYZE FORMAT=JSON SELECT 1", analyze: true, wantOK: true},
		{stmt: "EXPLAIN FORMAT=TRADITIONAL SELECT 1", wantOK: false},
		// The statistics command.
		{stmt: "ANALYZE TABLE users", wantOK: false},
		{stmt: "EXPLAIN users", wantOK: false},
		{stmt: "DESCRIBE users", wantOK: false},
	}
	for _, tc := range tests {
		got, ok := DetectPlanRequest(DriverMySQL, tc.stmt)
		if ok != tc.wantOK {
			t.Errorf("DetectPlanRequest(%q) ok = %v, want %v", tc.stmt, ok, tc.wantOK)
			continue
		}
		if !ok {
			continue
		}
		if got.SQL != tc.wantSQL || got.Analyze != tc.analyze {
			t.Errorf("DetectPlanRequest(%q) = %q analyze=%v, want %q analyze=%v",
				tc.stmt, got.SQL, got.Analyze, tc.wantSQL, tc.analyze)
		}
	}
}

func TestDetectPlanRequestSQLite(t *testing.T) {
	got, ok := DetectPlanRequest(DriverSQLite, "EXPLAIN QUERY PLAN SELECT 1")
	if !ok || got.SQL != "EXPLAIN QUERY PLAN SELECT 1" || got.Analyze {
		t.Errorf("EXPLAIN QUERY PLAN → %+v, ok=%v", got, ok)
	}
	// Bytecode, not a plan.
	if _, ok := DetectPlanRequest(DriverSQLite, "EXPLAIN SELECT 1"); ok {
		t.Error("SQLite's bytecode EXPLAIN must not be treated as a plan request")
	}
}

// Run executes what you typed; the classifier only picks how to ask for the plan.
func TestDetectPlanRequestKeepsWrites(t *testing.T) {
	got, ok := DetectPlanRequest(DriverPostgres, "EXPLAIN ANALYZE DELETE FROM t")
	if !ok {
		t.Fatal("expected a plan request")
	}
	if !got.Analyze {
		t.Error("expected the request to report that it executes")
	}
	if !strings.Contains(got.SQL, "DELETE FROM t") {
		t.Errorf("inner statement lost: %q", got.SQL)
	}
}
