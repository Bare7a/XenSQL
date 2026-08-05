package database

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

type PlanField struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// PlanNode is one operation in a normalized plan tree.
type PlanNode struct {
	Label       string   `json:"label"`
	Detail      string   `json:"detail,omitempty"`
	Relation    string   `json:"relation,omitempty"`
	Index       string   `json:"index,omitempty"`
	CostTotal   *float64 `json:"costTotal,omitempty"`
	CostSelf    *float64 `json:"costSelf,omitempty"`
	RowsPlanned *float64 `json:"rowsPlanned,omitempty"`
	// Totals across every loop, not the per-loop averages Postgres and MariaDB report.
	RowsActual *float64    `json:"rowsActual,omitempty"`
	Loops      *float64    `json:"loops,omitempty"`
	TimeMs     *float64    `json:"timeMs,omitempty"`
	SelfTimeMs *float64    `json:"selfTimeMs,omitempty"`
	NeverRun   bool        `json:"neverRun,omitempty"`
	Fields     []PlanField `json:"fields,omitempty"`
	Children   []PlanNode  `json:"children,omitempty"`
}

// Note codes the frontend translates.
const (
	PlanNoteNoMetrics      = "noMetrics"
	PlanNoteRolledBack     = "rolledBack"
	PlanNoteTabTransaction = "tabTransaction"
)

type QueryPlan struct {
	Driver      DriverType `json:"driver"`
	Statement   string     `json:"statement"`
	ExplainSQL  string     `json:"explainSql"`
	Analyzed    bool       `json:"analyzed"`
	Nodes       []PlanNode `json:"nodes"`
	TotalCost   *float64   `json:"totalCost,omitempty"`
	PlanningMs  *float64   `json:"planningMs,omitempty"`
	ExecutionMs *float64   `json:"executionMs,omitempty"`
	DurationMs  int64      `json:"durationMs"`
	Notes       []string   `json:"notes,omitempty"`
	Raw         string     `json:"raw"`
}

func (p *QueryPlan) AddNote(code string) {
	if p.HasNote(code) {
		return
	}
	p.Notes = append(p.Notes, code)
}

func (p *QueryPlan) HasNote(code string) bool {
	for _, existing := range p.Notes {
		if existing == code {
			return true
		}
	}
	return false
}

// ServerVersion picks the EXPLAIN syntax: MariaDB and MySQL disagree on how to ask for a
// measured plan, and MySQL only learned to at all in 8.0.18.
type ServerVersion struct {
	MariaDB bool
	Major   int
	Minor   int
	Patch   int
}

func (v ServerVersion) atLeast(major, minor, patch int) bool {
	if v.Major != major {
		return v.Major > major
	}
	if v.Minor != minor {
		return v.Minor > minor
	}
	return v.Patch >= patch
}

func (v ServerVersion) String() string {
	return fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch)
}

var (
	versionNumberRe = regexp.MustCompile(`(\d+)\.(\d+)(?:\.(\d+))?`)
	// Old MariaDB builds prefix "5.5.5-" so clients gating on 5.x keep working.
	mariaCompatPrefix = "5.5.5-"
)

func ParseServerVersion(raw string) ServerVersion {
	raw = strings.TrimSpace(raw)
	v := ServerVersion{MariaDB: strings.Contains(strings.ToLower(raw), "mariadb")}
	if v.MariaDB {
		raw = strings.TrimPrefix(raw, mariaCompatPrefix)
	}
	m := versionNumberRe.FindStringSubmatch(raw)
	if m == nil {
		return v
	}
	v.Major, _ = strconv.Atoi(m[1])
	v.Minor, _ = strconv.Atoi(m[2])
	v.Patch, _ = strconv.Atoi(m[3])
	return v
}

func SingleStatement(driver DriverType, sql string) (string, error) {
	stmts := SplitStatements(driver, sql)
	switch len(stmts) {
	case 0:
		return "", errors.New("no statement to explain")
	case 1:
		return stmts[0], nil
	default:
		return "", errors.New("select a single statement to explain")
	}
}

var (
	pgExplainPrefixRe     = regexp.MustCompile(`(?is)^explain\s*(?:\(.*?\)\s*)?(?:analyze\s+)?(?:verbose\s+)?`)
	mysqlExplainPrefixRe  = regexp.MustCompile(`(?is)^(?:explain|analyze)\s+(?:analyze\s+)?(?:format\s*=\s*\w+\s+)?`)
	sqliteExplainPrefixRe = regexp.MustCompile(`(?is)^explain\s+(?:query\s+plan\s+)?`)
)

// Explaining a plan query plans the underlying statement instead of nesting the EXPLAIN.
func stripExplainPrefix(driver DriverType, stmt string) string {
	var re *regexp.Regexp
	switch driver {
	case DriverPostgres:
		re = pgExplainPrefixRe
	case DriverMySQL:
		re = mysqlExplainPrefixRe
	case DriverSQLite:
		re = sqliteExplainPrefixRe
	default:
		return stmt
	}
	prefix := re.FindString(stmt)
	if prefix == "" {
		return stmt
	}
	rest := strings.TrimSpace(stmt[len(prefix):])
	if !explainsAStatement(strings.ToUpper(strings.TrimSpace(prefix)), rest) {
		return stmt
	}
	return rest
}

func isExplainableStart(stmt string) bool {
	switch firstKeyword(stmt) {
	case "SELECT", "WITH", "INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE", "VALUES", "TABLE":
		return true
	}
	return false
}

// `ANALYZE TABLE t` is MySQL's statistics command, not a plan of a TABLE statement.
func explainsAStatement(keyword, rest string) bool {
	if !isExplainableStart(rest) {
		return false
	}
	return !(keyword == "ANALYZE" && firstKeyword(rest) == "TABLE")
}

type PlanRequest struct {
	SQL     string
	Analyze bool
}

type explainIntent struct {
	analyze bool
	format  string
	inner   string
	// SQLite's bare EXPLAIN lists bytecode instead, with nothing in common with a plan.
	queryPlan bool
}

var (
	pgExplainHeadRe     = regexp.MustCompile(`(?is)^explain\s*(?:\(([^)]*)\)\s*)?((?:(?:analyze|verbose)\s+)*)`)
	pgAnalyzeOptRe      = regexp.MustCompile(`(?is)\banalyze\b(?:\s+(\w+))?`)
	pgFormatOptRe       = regexp.MustCompile(`(?is)\bformat\s+(\w+)`)
	mysqlExplainHeadRe  = regexp.MustCompile(`(?is)^(explain|analyze)\s+(analyze\s+)?(?:format\s*=\s*(\w+)\s+)?`)
	sqliteExplainHeadRe = regexp.MustCompile(`(?is)^explain\s+(query\s+plan\s+)?`)
)

func isFalsey(word string) bool {
	switch strings.ToLower(word) {
	case "false", "off", "0":
		return true
	}
	return false
}

func parseExplainIntent(driver DriverType, stmt string) (explainIntent, bool) {
	switch driver {
	case DriverPostgres:
		m := pgExplainHeadRe.FindStringSubmatch(stmt)
		if m == nil {
			return explainIntent{}, false
		}
		intent := explainIntent{inner: strings.TrimSpace(stmt[len(m[0]):])}
		if options := m[1]; options != "" {
			if am := pgAnalyzeOptRe.FindStringSubmatch(options); am != nil {
				intent.analyze = !isFalsey(am[1])
			}
			if fm := pgFormatOptRe.FindStringSubmatch(options); fm != nil {
				intent.format = strings.ToLower(fm[1])
			}
		}
		// Legacy syntax has no parentheses: EXPLAIN ANALYZE VERBOSE <stmt>.
		if strings.Contains(strings.ToLower(m[2]), "analyze") {
			intent.analyze = true
		}
		return intent, true
	case DriverMySQL:
		m := mysqlExplainHeadRe.FindStringSubmatch(stmt)
		if m == nil {
			return explainIntent{}, false
		}
		return explainIntent{
			analyze: strings.EqualFold(m[1], "analyze") || m[2] != "",
			format:  strings.ToLower(m[3]),
			inner:   strings.TrimSpace(stmt[len(m[0]):]),
		}, true
	case DriverSQLite:
		m := sqliteExplainHeadRe.FindStringSubmatch(stmt)
		if m == nil {
			return explainIntent{}, false
		}
		return explainIntent{inner: strings.TrimSpace(stmt[len(m[0]):]), queryPlan: m[1] != ""}, true
	default:
		return explainIntent{}, false
	}
}

// DetectPlanRequest reports whether a typed statement asks for a plan, and which EXPLAIN to run.
// Output that already carries structure (any FORMAT JSON, MySQL's EXPLAIN ANALYZE tree, SQLite's
// EXPLAIN QUERY PLAN) runs as typed; Postgres text and MySQL's traditional table are asked again
// in JSON. ok is false where the user wants raw output: a named text/XML/YAML/traditional format,
// or SQLite's bytecode EXPLAIN.
func DetectPlanRequest(driver DriverType, stmt string) (PlanRequest, bool) {
	stmt = strings.TrimSpace(StripLeadingComments(stmt))
	first := firstKeyword(stmt)
	if first != "EXPLAIN" && !(driver == DriverMySQL && first == "ANALYZE") {
		return PlanRequest{}, false
	}
	intent, ok := parseExplainIntent(driver, stmt)
	if !ok || !explainsAStatement(first, intent.inner) {
		return PlanRequest{}, false
	}

	switch driver {
	case DriverPostgres:
		switch intent.format {
		case "json":
			return PlanRequest{SQL: stmt, Analyze: intent.analyze}, true
		case "":
			sql, err := BuildExplainSQL(driver, ServerVersion{}, intent.inner, intent.analyze)
			if err != nil {
				return PlanRequest{}, false
			}
			return PlanRequest{SQL: sql, Analyze: intent.analyze}, true
		default:
			return PlanRequest{}, false
		}
	case DriverMySQL:
		switch intent.format {
		case "json", "tree":
			return PlanRequest{SQL: stmt, Analyze: intent.analyze}, true
		case "":
			// EXPLAIN ANALYZE already answers with the tree; other bare forms are the traditional table.
			if intent.analyze && first == "EXPLAIN" {
				return PlanRequest{SQL: stmt, Analyze: true}, true
			}
			if intent.analyze {
				return PlanRequest{SQL: "ANALYZE FORMAT=JSON " + intent.inner, Analyze: true}, true
			}
			return PlanRequest{SQL: "EXPLAIN FORMAT=JSON " + intent.inner, Analyze: false}, true
		default:
			return PlanRequest{}, false
		}
	case DriverSQLite:
		if !intent.queryPlan {
			return PlanRequest{}, false
		}
		return PlanRequest{SQL: stmt, Analyze: false}, true
	default:
		return PlanRequest{}, false
	}
}

// BuildExplainSQL renders the EXPLAIN for driver. analyze means the statement actually runs, so
// callers must isolate a write themselves.
func BuildExplainSQL(driver DriverType, sv ServerVersion, stmt string, analyze bool) (string, error) {
	stmt = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(stmt), ";"))
	if stmt == "" {
		return "", errors.New("no statement to explain")
	}
	stmt = stripExplainPrefix(driver, stmt)
	switch driver {
	case DriverPostgres:
		if analyze {
			return "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + stmt, nil
		}
		return "EXPLAIN (FORMAT JSON) " + stmt, nil
	case DriverMySQL:
		switch {
		case !analyze:
			return "EXPLAIN FORMAT=JSON " + stmt, nil
		case sv.MariaDB:
			return "ANALYZE FORMAT=JSON " + stmt, nil
		case sv.atLeast(8, 0, 18):
			// MySQL only accepts FORMAT=JSON on EXPLAIN ANALYZE from 8.3; TREE works from 8.0.18.
			return "EXPLAIN ANALYZE " + stmt, nil
		default:
			return "", fmt.Errorf("EXPLAIN ANALYZE needs MySQL 8.0.18 or newer (server reports %s)", sv)
		}
	case DriverSQLite:
		if analyze {
			return "", errors.New("SQLite has no EXPLAIN ANALYZE; explain without it for the plan shape")
		}
		return "EXPLAIN QUERY PLAN " + stmt, nil
	default:
		return "", fmt.Errorf("unsupported driver: %s", driver)
	}
}

// ExplainPlan runs the driver's EXPLAIN for stmt on conn and normalizes the output. conn is pinned
// so an ANALYZE the caller wrapped in a transaction stays inside it.
func ExplainPlan(ctx context.Context, conn PinnedConn, driver DriverType, stmt string, analyze bool) (*QueryPlan, error) {
	var sv ServerVersion
	if driver == DriverMySQL && analyze {
		detected, err := detectServerVersion(ctx, conn)
		if err != nil {
			return nil, err
		}
		sv = detected
	}
	explainSQL, err := BuildExplainSQL(driver, sv, stmt, analyze)
	if err != nil {
		return nil, err
	}
	start := NowMs()
	res, err := runBufferedOn(ctx, conn, explainSQL)
	if err != nil {
		return nil, err
	}
	plan, err := ParsePlan(driver, stmt, explainSQL, analyze, res)
	if err != nil {
		return nil, err
	}
	plan.DurationMs = NowMs() - start
	return plan, nil
}

func runBufferedOn(ctx context.Context, conn PinnedConn, sql string) (*QueryResult, error) {
	return collectStream(func(opts StreamOpts) (*QueryResult, error) {
		return conn.ExecuteStream(ctx, sql, opts)
	})
}

func detectServerVersion(ctx context.Context, conn PinnedConn) (ServerVersion, error) {
	res, err := runBufferedOn(ctx, conn, "SELECT VERSION()")
	if err != nil {
		return ServerVersion{}, err
	}
	return ParseServerVersion(planString(firstCell(res))), nil
}

func ParsePlan(driver DriverType, stmt, explainSQL string, analyze bool, res *QueryResult) (*QueryPlan, error) {
	if res == nil || len(res.Rows) == 0 {
		return nil, errors.New("the server returned no plan")
	}
	plan := &QueryPlan{
		Driver:     driver,
		Statement:  stmt,
		ExplainSQL: explainSQL,
		Analyzed:   analyze,
		// One text column for both JSON formats and the tree text; parseSQLitePlan re-renders its own.
		Raw: joinFirstColumn(res),
	}
	var err error
	switch driver {
	case DriverPostgres:
		err = parsePostgresPlan(plan)
	case DriverMySQL:
		err = parseMySQLPlan(plan)
	case DriverSQLite:
		parseSQLitePlan(plan, res)
	default:
		err = fmt.Errorf("unsupported driver: %s", driver)
	}
	if err != nil {
		return nil, err
	}
	if len(plan.Nodes) == 0 {
		return nil, errors.New("the server returned no plan")
	}
	// Notes carry only what the viewer can't show otherwise; the badge already reports estimates.
	return plan, nil
}
