package database

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// planBuilder builds a tree whose shape is only known while scanning (MySQL indented text,
// SQLite's id/parent rows). finish() flattens bottom-up, so a node is finalized after its children.
type planBuilder struct {
	node     PlanNode
	children []*planBuilder
}

func (b *planBuilder) finish() PlanNode {
	for _, child := range b.children {
		b.node.Children = append(b.node.Children, child.finish())
	}
	finalizeNode(&b.node)
	return b.node
}

func finishAll(builders []*planBuilder) []PlanNode {
	nodes := make([]PlanNode, 0, len(builders))
	for _, b := range builders {
		nodes = append(nodes, b.finish())
	}
	return nodes
}

// finalizeNode derives whichever of the inclusive/exclusive metrics the engine left out. Clamped at
// zero: Postgres leaves InitPlan/SubPlan children out of a parent's total.
func finalizeNode(n *PlanNode) {
	var childCost, childTime float64
	var haveChildCost, haveChildTime bool
	for i := range n.Children {
		if c := n.Children[i].CostTotal; c != nil {
			childCost += *c
			haveChildCost = true
		}
		if t := n.Children[i].TimeMs; t != nil {
			childTime += *t
			haveChildTime = true
		}
	}
	n.CostTotal, n.CostSelf = deriveTotals(n.CostTotal, n.CostSelf, childCost, haveChildCost)
	n.TimeMs, n.SelfTimeMs = deriveTotals(n.TimeMs, n.SelfTimeMs, childTime, haveChildTime)
}

// Postgres reports the inclusive value, MariaDB an exclusive one, and either can be missing.
func deriveTotals(total, self *float64, childSum float64, haveChildren bool) (*float64, *float64) {
	switch {
	case total != nil && self == nil:
		return total, ptrFloat(max(0, *total-childSum))
	case total == nil && self != nil:
		return ptrFloat(*self + childSum), self
	case total == nil && self == nil && haveChildren:
		return ptrFloat(childSum), ptrFloat(0)
	default:
		return total, self
	}
}

// ---------- Postgres: EXPLAIN (FORMAT JSON) ----------

// Already first-class metrics.
var pgFirstClassKeys = map[string]bool{
	"Node Type": true, "Plans": true, "Relation Name": true, "Alias": true, "Index Name": true,
	"Total Cost": true, "Plan Rows": true, "Join Type": true, "Strategy": true,
	"Subplan Name": true, "Parallel Aware": true,
	"Actual Total Time": true, "Actual Rows": true, "Actual Loops": true,
}

// Most specific clause first.
var pgDetailKeys = []string{
	"Index Cond", "Recheck Cond", "TID Cond", "Hash Cond", "Merge Cond", "Join Filter",
	"Filter", "One-Time Filter", "Sort Key", "Group Key", "Presorted Key", "Cache Key",
	"Function Call", "Table Function Name", "CTE Name", "Conflict Filter",
}

func parsePostgresPlan(plan *QueryPlan) error {
	var envelopes []map[string]any
	if err := json.Unmarshal([]byte(plan.Raw), &envelopes); err != nil {
		return fmt.Errorf("could not read the Postgres plan: %w", err)
	}
	for _, env := range envelopes {
		root, ok := env["Plan"].(map[string]any)
		if !ok {
			continue
		}
		plan.Nodes = append(plan.Nodes, pgNode(root))
		if v := optFloat(env["Planning Time"]); v != nil {
			plan.PlanningMs = v
		}
		if v := optFloat(env["Execution Time"]); v != nil {
			plan.ExecutionMs = v
		}
	}
	if len(plan.Nodes) > 0 {
		plan.TotalCost = plan.Nodes[0].CostTotal
	}
	return nil
}

func pgNode(raw map[string]any) PlanNode {
	detailKey, detail := pgDetail(raw)
	n := PlanNode{
		Label:       pgLabel(raw),
		Detail:      detail,
		Relation:    pgRelation(raw),
		Index:       planString(raw["Index Name"]),
		CostTotal:   optFloat(raw["Total Cost"]),
		RowsPlanned: optFloat(raw["Plan Rows"]),
		Fields:      planFields(raw, pgFirstClassKeys, detailKey),
	}
	// Postgres reports per-loop averages; scale by loops so nested-loop nodes compare fairly.
	loops := 1.0
	if v, ok := planFloat(raw["Actual Loops"]); ok {
		n.Loops = ptrFloat(v)
		n.NeverRun = v == 0
		loops = v
	}
	if v, ok := planFloat(raw["Actual Total Time"]); ok {
		n.TimeMs = ptrFloat(v * loops)
	}
	if v, ok := planFloat(raw["Actual Rows"]); ok {
		n.RowsActual = ptrFloat(v * loops)
	}
	for _, child := range asObjectSlice(raw["Plans"]) {
		n.Children = append(n.Children, pgNode(child))
	}
	finalizeNode(&n)
	return n
}

func pgLabel(raw map[string]any) string {
	label := planString(raw["Node Type"])
	if label == "" {
		label = "Node"
	}
	if join := planString(raw["Join Type"]); join != "" && join != "Inner" {
		label += " (" + join + ")"
	}
	if strategy := planString(raw["Strategy"]); strategy != "" && strategy != "Plain" {
		label += " (" + strategy + ")"
	}
	if raw["Parallel Aware"] == true {
		label = "Parallel " + label
	}
	if name := planString(raw["Subplan Name"]); name != "" {
		label = name + ": " + label
	}
	return label
}

func pgRelation(raw map[string]any) string {
	relation := planString(raw["Relation Name"])
	alias := planString(raw["Alias"])
	if alias == "" || alias == relation {
		return relation
	}
	if relation == "" {
		return alias
	}
	return relation + " " + alias
}

// pgDetail returns the clause and its key, so planFields can skip what's already displayed.
func pgDetail(raw map[string]any) (string, string) {
	for _, key := range pgDetailKeys {
		if v := planString(raw[key]); v != "" {
			return key, v
		}
	}
	return "", ""
}

// ---------- MySQL / MariaDB ----------

func parseMySQLPlan(plan *QueryPlan) error {
	if strings.HasPrefix(strings.TrimSpace(plan.Raw), "{") {
		return parseMySQLJSONPlan(plan)
	}
	parseMySQLTreePlan(plan)
	return nil
}

// Operation keys MySQL and MariaDB use; anything unlisted falls back to the humanized key.
var mysqlOpLabels = map[string]string{
	"query_block":                "Query block",
	"table":                      "Table",
	"nested_loop":                "Nested loop",
	"ordering_operation":         "Ordering",
	"grouping_operation":         "Grouping",
	"duplicates_removal":         "Duplicates removal",
	"materialized_from_subquery": "Materialized subquery",
	"union_result":               "Union result",
	"query_specifications":       "Query specification",
	"buffer_result":              "Buffer result",
	"block-nl-join":              "Block nested loop join",
	"read_sorted_file":           "Read sorted file",
	"temporary_table":            "Temporary table",
	"attached_subqueries":        "Attached subquery",
	"select_list_subqueries":     "Select list subquery",
	"having_subqueries":          "Having subquery",
	"optimized_away_subqueries":  "Optimized-away subquery",
	"update_value_subqueries":    "Update value subquery",
	"subqueries":                 "Subquery",
	"insert_from":                "Insert from",
}

// Folded into the parent instead of becoming a child node.
var mysqlFoldedObjects = map[string]bool{"cost_info": true}

var mysqlFirstClassKeys = map[string]bool{
	"table_name": true, "access_type": true, "key": true, "cost_info": true, "cost": true,
	"rows_produced_per_join": true, "rows": true,
	"r_rows": true, "r_loops": true, "r_total_time_ms": true,
	"r_table_time_ms": true, "r_other_time_ms": true,
}

// Most specific clause first.
var mysqlDetailKeys = []string{"attached_condition", "index_condition"}

func parseMySQLJSONPlan(plan *QueryPlan) error {
	var root map[string]any
	if err := json.Unmarshal([]byte(plan.Raw), &root); err != nil {
		return fmt.Errorf("could not read the MySQL plan: %w", err)
	}
	for _, key := range sortedKeys(root) {
		obj, ok := root[key].(map[string]any)
		if !ok {
			continue
		}
		plan.Nodes = append(plan.Nodes, mysqlNode(key, obj))
	}
	if len(plan.Nodes) > 0 {
		plan.TotalCost = plan.Nodes[0].CostTotal
		plan.ExecutionMs = plan.Nodes[0].TimeMs
	}
	return nil
}

func mysqlNode(key string, raw map[string]any) PlanNode {
	detailKey, detail := firstStringField(raw, mysqlDetailKeys)
	n := PlanNode{
		Label:    mysqlLabel(key, raw),
		Detail:   detail,
		Relation: planString(raw["table_name"]),
		Index:    planString(raw["key"]),
		Fields:   planFields(raw, mysqlFirstClassKeys, detailKey),
	}
	mysqlCost(&n, raw)
	mysqlRowsAndTime(&n, raw)
	n.Children = mysqlChildren(raw)
	finalizeNode(&n)
	return n
}

// MySQL nests cost under cost_info, MariaDB 11 reports a flat per-node cost. prefix_cost is the
// running cost of the join prefix, so summing it double-counts; read+eval is the node's own.
func mysqlCost(n *PlanNode, raw map[string]any) {
	info, _ := raw["cost_info"].(map[string]any)
	n.Fields = append(n.Fields, planFields(info, nil, "")...)
	if flat := optFloat(raw["cost"]); flat != nil {
		n.CostSelf = flat
		return
	}
	if info == nil {
		return
	}
	n.CostTotal = optFloat(info["query_cost"])
	read, hasRead := planFloat(info["read_cost"])
	eval, hasEval := planFloat(info["eval_cost"])
	if hasRead || hasEval {
		n.CostSelf = ptrFloat(read + eval)
	}
}

func mysqlRowsAndTime(n *PlanNode, raw map[string]any) {
	n.RowsPlanned = firstFloat(raw["rows_produced_per_join"], raw["rows_examined_per_scan"], raw["rows"])
	// MariaDB's r_rows is per-loop like Postgres; its time counters are already totals.
	loops := 1.0
	if v, ok := planFloat(raw["r_loops"]); ok {
		n.Loops = ptrFloat(v)
		n.NeverRun = v == 0
		loops = v
	}
	if v, ok := planFloat(raw["r_rows"]); ok {
		n.RowsActual = ptrFloat(v * loops)
	}
	if v := optFloat(raw["r_total_time_ms"]); v != nil {
		n.TimeMs = v
		return
	}
	table, hasTable := planFloat(raw["r_table_time_ms"])
	other, hasOther := planFloat(raw["r_other_time_ms"])
	if hasTable || hasOther {
		n.SelfTimeMs = ptrFloat(table + other)
	}
}

func mysqlLabel(key string, raw map[string]any) string {
	label := mysqlOpLabels[key]
	if label == "" {
		label = humanizeKey(key)
	}
	if access := planString(raw["access_type"]); access != "" {
		label += " (" + access + ")"
	}
	if key == "query_block" {
		if id := planString(raw["select_id"]); id != "" {
			label += " #" + id
		}
	}
	return label
}

// Every nested object is a child; an array of objects becomes one grouping node holding them.
func mysqlChildren(raw map[string]any) []PlanNode {
	var children []PlanNode
	for _, key := range sortedKeys(raw) {
		if mysqlFoldedObjects[key] {
			continue
		}
		switch v := raw[key].(type) {
		case map[string]any:
			children = append(children, mysqlNode(key, v))
		case []any:
			if group, ok := mysqlGroupNode(key, v); ok {
				children = append(children, group)
			}
		}
	}
	return children
}

// ok=false for arrays of scalars (possible_keys, used_columns), which planFields renders instead.
func mysqlGroupNode(key string, arr []any) (PlanNode, bool) {
	objects := asObjectSlice(arr)
	if len(objects) == 0 || len(objects) != len(arr) {
		return PlanNode{}, false
	}
	group := PlanNode{Label: firstNonEmpty(mysqlOpLabels[key], humanizeKey(key))}
	for _, obj := range objects {
		// Unwrap the single-key envelopes MySQL uses so the child is labelled by its operation.
		if innerKey, inner, ok := soleObjectEntry(obj); ok {
			group.Children = append(group.Children, mysqlNode(innerKey, inner))
			continue
		}
		group.Children = append(group.Children, mysqlNode(key, obj))
	}
	finalizeNode(&group)
	return group, true
}

// ---------- MySQL: EXPLAIN ANALYZE (tree text) ----------

var (
	treeLineRe   = regexp.MustCompile(`^(\s*)->\s*(.*)$`)
	treeCostRe   = regexp.MustCompile(`\(cost=([0-9.eE+-]+)(?:\.\.([0-9.eE+-]+))?\s+rows=([0-9.eE+-]+)\)`)
	treeActualRe = regexp.MustCompile(`\(actual time=([0-9.eE+-]+)\.\.([0-9.eE+-]+)\s+rows=([0-9.eE+-]+)\s+loops=([0-9.eE+-]+)\)`)
	treeNeverRe  = regexp.MustCompile(`\(never executed\)`)
	treeOnRe     = regexp.MustCompile(`\bon\s+([^\s(]+)`)
	treeUsingRe  = regexp.MustCompile(`\busing\s+([^\s(]+)`)
)

func parseMySQLTreePlan(plan *QueryPlan) {
	var roots []*planBuilder
	type frame struct {
		indent  int
		builder *planBuilder
	}
	var stack []frame
	for _, line := range strings.Split(plan.Raw, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		indent, text := treeLineParts(line)
		builder := &planBuilder{node: treeNode(text)}
		for len(stack) > 0 && stack[len(stack)-1].indent >= indent {
			stack = stack[:len(stack)-1]
		}
		if len(stack) == 0 {
			roots = append(roots, builder)
		} else {
			parent := stack[len(stack)-1].builder
			parent.children = append(parent.children, builder)
		}
		stack = append(stack, frame{indent: indent, builder: builder})
	}
	plan.Nodes = finishAll(roots)
	if len(plan.Nodes) > 0 {
		plan.TotalCost = plan.Nodes[0].CostTotal
		plan.ExecutionMs = plan.Nodes[0].TimeMs
	}
}

// A line without the "-> " marker belongs to the root, at indent 0.
func treeLineParts(line string) (int, string) {
	if m := treeLineRe.FindStringSubmatch(line); m != nil {
		return len(m[1]), strings.TrimSpace(m[2])
	}
	return 0, strings.TrimSpace(line)
}

func treeNode(text string) PlanNode {
	n := PlanNode{}
	if m := treeCostRe.FindStringSubmatch(text); m != nil {
		n.CostTotal = parseFloatPtr(m[1])
		n.RowsPlanned = parseFloatPtr(m[3])
		text = strings.Replace(text, m[0], "", 1)
	}
	if m := treeActualRe.FindStringSubmatch(text); m != nil {
		loops := 1.0
		if v, err := strconv.ParseFloat(m[4], 64); err == nil {
			n.Loops = ptrFloat(v)
			loops = v
		}
		// first-row and last-row, both per loop.
		if v, err := strconv.ParseFloat(m[2], 64); err == nil {
			n.TimeMs = ptrFloat(v * loops)
		}
		if v, err := strconv.ParseFloat(m[3], 64); err == nil {
			n.RowsActual = ptrFloat(v * loops)
		}
		text = strings.Replace(text, m[0], "", 1)
	}
	if loc := treeNeverRe.FindString(text); loc != "" {
		n.NeverRun = true
		text = strings.Replace(text, loc, "", 1)
	}
	n.Label, n.Detail = splitLabelDetail(strings.TrimSpace(text))
	// Read these off the operation only: a filter clause can contain "on" or "using".
	if m := treeOnRe.FindStringSubmatch(n.Label); m != nil {
		n.Relation = m[1]
	}
	if m := treeUsingRe.FindStringSubmatch(n.Label); m != nil {
		n.Index = m[1]
	}
	return n
}

func splitLabelDetail(text string) (string, string) {
	idx := strings.Index(text, ": ")
	if idx <= 0 {
		return text, ""
	}
	return strings.TrimSpace(text[:idx]), strings.TrimSpace(text[idx+2:])
}

// ---------- SQLite: EXPLAIN QUERY PLAN ----------

var (
	sqliteScanRe  = regexp.MustCompile(`(?i)^(SCAN|SEARCH)\s+(?:TABLE\s+|SUBQUERY\s+)?(\S+)\s*(.*)$`)
	sqliteIndexRe = regexp.MustCompile(`(?i)\bUSING\s+(?:COVERING\s+)?(?:AUTOMATIC\s+)?(?:PARTIAL\s+)?INDEX\s+([^\s(]+)`)
)

// parseSQLitePlan rebuilds the tree from the id/parent columns. SQLite reports plan shape only.
func parseSQLitePlan(plan *QueryPlan, res *QueryResult) {
	idID := columnIndex(res, "id", 0)
	idParent := columnIndex(res, "parent", 1)
	idDetail := columnIndex(res, "detail", 3)

	byID := map[int64]*planBuilder{}
	var roots []*planBuilder
	var raw strings.Builder
	for _, row := range res.Rows {
		id, _ := planFloat(cellAt(row, idID))
		parent, _ := planFloat(cellAt(row, idParent))
		detail := planString(cellAt(row, idDetail))
		builder := &planBuilder{node: sqliteNode(detail)}
		byID[int64(id)] = builder
		if p, ok := byID[int64(parent)]; ok && int64(parent) != int64(id) {
			p.children = append(p.children, builder)
		} else {
			roots = append(roots, builder)
		}
		fmt.Fprintf(&raw, "%d|%d|%s\n", int64(id), int64(parent), detail)
	}
	plan.Nodes = finishAll(roots)
	plan.Raw = strings.TrimRight(raw.String(), "\n")
	plan.AddNote(PlanNoteNoMetrics)
}

func sqliteNode(detail string) PlanNode {
	m := sqliteScanRe.FindStringSubmatch(strings.TrimSpace(detail))
	if m == nil {
		return PlanNode{Label: detail}
	}
	n := PlanNode{
		Label:    strings.ToUpper(m[1]),
		Relation: m[2],
		Detail:   strings.TrimSpace(m[3]),
	}
	if idx := sqliteIndexRe.FindStringSubmatch(n.Detail); idx != nil {
		n.Index = idx[1]
	}
	return n
}

// ---------- value helpers ----------

// planFields renders the engine's remaining scalars, skipping skip and alsoSkip (the detail key).
// Nested objects and arrays of objects are children, not fields.
func planFields(raw map[string]any, skip map[string]bool, alsoSkip string) []PlanField {
	var fields []PlanField
	for _, key := range sortedKeys(raw) {
		if skip[key] || (alsoSkip != "" && key == alsoSkip) {
			continue
		}
		switch v := raw[key].(type) {
		case nil, map[string]any:
			continue
		case []any:
			if len(asObjectSlice(v)) > 0 {
				continue
			}
			if s := planString(v); s != "" {
				fields = append(fields, PlanField{Key: humanizeKey(key), Value: s})
			}
		default:
			if s := planString(v); s != "" {
				fields = append(fields, PlanField{Key: humanizeKey(key), Value: s})
			}
		}
	}
	return fields
}

func planString(v any) string {
	switch val := v.(type) {
	case nil:
		return ""
	case string:
		return val
	case bool:
		return strconv.FormatBool(val)
	case float64:
		return strconv.FormatFloat(val, 'g', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(val), 'g', -1, 32)
	case int64:
		return strconv.FormatInt(val, 10)
	case int:
		return strconv.Itoa(val)
	case json.Number:
		return val.String()
	case []any:
		parts := make([]string, 0, len(val))
		for _, item := range val {
			if s := planString(item); s != "" {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, ", ")
	default:
		return fmt.Sprintf("%v", val)
	}
}

// The engines mix JSON numbers, quoted numbers ("1.35") and driver integer types.
func planFloat(v any) (float64, bool) {
	switch val := v.(type) {
	case float64:
		return val, true
	case float32:
		return float64(val), true
	case int64:
		return float64(val), true
	case int:
		return float64(val), true
	case json.Number:
		f, err := val.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(val), 64)
		return f, err == nil
	default:
		return 0, false
	}
}

func optFloat(v any) *float64 {
	if f, ok := planFloat(v); ok {
		return &f
	}
	return nil
}

func firstFloat(values ...any) *float64 {
	for _, v := range values {
		if f := optFloat(v); f != nil {
			return f
		}
	}
	return nil
}

func firstStringField(raw map[string]any, keys []string) (string, string) {
	for _, key := range keys {
		if v := planString(raw[key]); v != "" {
			return key, v
		}
	}
	return "", ""
}

func parseFloatPtr(s string) *float64 {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	return &f
}

func ptrFloat(f float64) *float64 { return &f }

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func asObjectSlice(v any) []map[string]any {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	var out []map[string]any
	for _, item := range arr {
		if obj, ok := item.(map[string]any); ok {
			out = append(out, obj)
		}
	}
	return out
}

func soleObjectEntry(obj map[string]any) (string, map[string]any, bool) {
	if len(obj) != 1 {
		return "", nil, false
	}
	for key, value := range obj {
		if inner, ok := value.(map[string]any); ok {
			return key, inner, true
		}
	}
	return "", nil, false
}

func humanizeKey(key string) string {
	if key == "" {
		return ""
	}
	spaced := strings.NewReplacer("_", " ", "-", " ").Replace(key)
	return strings.ToUpper(spaced[:1]) + spaced[1:]
}

func firstCell(res *QueryResult) any {
	if res == nil || len(res.Rows) == 0 || len(res.Rows[0]) == 0 {
		return nil
	}
	return res.Rows[0][0]
}

// Both JSON formats arrive as one row; MySQL tree text as one row of newline-separated lines.
func joinFirstColumn(res *QueryResult) string {
	if res == nil {
		return ""
	}
	parts := make([]string, 0, len(res.Rows))
	for _, row := range res.Rows {
		if len(row) == 0 {
			continue
		}
		parts = append(parts, planString(row[0]))
	}
	return strings.Join(parts, "\n")
}

func columnIndex(res *QueryResult, name string, fallback int) int {
	for i, col := range res.Columns {
		if strings.EqualFold(col, name) {
			return i
		}
	}
	return fallback
}

func cellAt(row []any, index int) any {
	if index < 0 || index >= len(row) {
		return nil
	}
	return row[index]
}
