package service

import (
	"encoding/json"
	"strings"
	"testing"

	"xensql/internal/database"
)

func sampleResult() *database.QueryResult {
	return &database.QueryResult{
		Columns:   []string{"id", "name", "score"},
		Rows:      [][]interface{}{{int64(1), "alice", 9.5}, {int64(2), nil, 7.0}},
		TableName: "players",
	}
}

func TestExportJSON(t *testing.T) {
	got, err := ExportResult(sampleResult(), "json")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	var decoded []map[string]interface{}
	if err := json.Unmarshal([]byte(got), &decoded); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if len(decoded) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(decoded))
	}
	if decoded[0]["name"] != "alice" {
		t.Fatalf("row 0 name: %v", decoded[0]["name"])
	}
	if decoded[1]["name"] != nil {
		t.Fatalf("row 1 name should be JSON null, got %v", decoded[1]["name"])
	}
}

func TestExportCSV(t *testing.T) {
	got, err := ExportResult(sampleResult(), "csv")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(got), "\n")
	if len(lines) != 3 {
		t.Fatalf("expected header + 2 rows, got %d", len(lines))
	}
	if !strings.HasPrefix(lines[0], "id,name,score") {
		t.Fatalf("unexpected header: %q", lines[0])
	}
	if !strings.Contains(lines[2], ",,") {
		t.Fatalf("nil value should be empty in CSV, got %q", lines[2])
	}
}

func TestExportSQL(t *testing.T) {
	got, err := ExportResult(sampleResult(), "sql")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if !strings.Contains(got, "INSERT INTO \"players\"") {
		t.Fatalf("expected INSERT statement, got: %s", got)
	}
	if !strings.Contains(got, "'alice'") {
		t.Fatalf("expected quoted alice, got: %s", got)
	}
	if !strings.Contains(got, "NULL") {
		t.Fatalf("expected NULL keyword, got: %s", got)
	}
}

func TestExportSQLFallsBackToResultsTableName(t *testing.T) {
	r := sampleResult()
	r.TableName = ""
	got, err := ExportResult(r, "sql")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	// Fallback matches TS exporter: `result.tableName || 'results'`.
	if !strings.Contains(got, `INSERT INTO "results"`) {
		t.Fatalf("expected fallback table name, got: %s", got)
	}
}

func TestExportSQLBooleanKeywords(t *testing.T) {
	r := &database.QueryResult{
		Columns:   []string{"active"},
		Rows:      [][]interface{}{{true}, {false}},
		TableName: "flags",
	}
	got, err := ExportResult(r, "sql")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if !strings.Contains(got, "VALUES (TRUE)") || !strings.Contains(got, "VALUES (FALSE)") {
		t.Fatalf("expected TRUE/FALSE keywords, got: %s", got)
	}
}

func TestExportJSONPreservesColumnOrder(t *testing.T) {
	r := &database.QueryResult{
		Columns: []string{"name", "id"}, // deliberately non-alphabetical
		Rows:    [][]interface{}{{"alice", int64(1)}},
	}
	got, err := ExportResult(r, "json")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	// encoding/json sorts map keys; this format must preserve column order instead.
	if strings.Index(got, `"name"`) > strings.Index(got, `"id"`) {
		t.Fatalf("expected column order preserved, got: %s", got)
	}
}

func TestExportText(t *testing.T) {
	got, err := ExportResult(sampleResult(), "text")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	// Tab-separated, no header row, nil → empty - mirrors the TS exporter.
	if got != "1\talice\t9.5\n2\t\t7" {
		t.Fatalf("unexpected text export: %q", got)
	}
}

func TestExportHasNoTrailingNewline(t *testing.T) {
	for _, format := range []string{"csv", "json", "markdown", "sql", "text"} {
		got, err := ExportResult(sampleResult(), format)
		if err != nil {
			t.Fatalf("%s export: %v", format, err)
		}
		if strings.HasSuffix(got, "\n") {
			t.Fatalf("%s export should not end with a newline, got: %q", format, got)
		}
	}
}

func TestExportSQLEscapesSingleQuotes(t *testing.T) {
	r := &database.QueryResult{
		Columns:   []string{"name"},
		Rows:      [][]interface{}{{"O'Reilly"}},
		TableName: "authors",
	}
	got, err := ExportResult(r, "sql")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if !strings.Contains(got, "'O''Reilly'") {
		t.Fatalf("expected escaped quote, got: %s", got)
	}
}

func TestExportMarkdown(t *testing.T) {
	got, err := ExportResult(sampleResult(), "markdown")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if !strings.HasPrefix(got, "| id | name | score |") {
		t.Fatalf("expected markdown header, got: %s", got)
	}
	if !strings.Contains(got, "| --- | --- | --- |") {
		t.Fatalf("expected separator row, got: %s", got)
	}
}

func TestExportMarkdownEscapesPipes(t *testing.T) {
	r := &database.QueryResult{
		Columns: []string{"name"},
		Rows:    [][]interface{}{{"foo|bar"}},
	}
	got, err := ExportResult(r, "markdown")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if !strings.Contains(got, `foo\|bar`) {
		t.Fatalf("expected pipe escaped, got: %s", got)
	}
}

func TestExportMarkdownEscapesPipesInHeader(t *testing.T) {
	r := &database.QueryResult{
		Columns: []string{"a|b", "x"},
		Rows:    [][]interface{}{{"1", "2"}},
	}
	got, err := ExportResult(r, "markdown")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	header := strings.SplitN(got, "\n", 2)[0]
	if !strings.Contains(header, `a\|b`) {
		t.Fatalf("expected header pipe escaped, got: %s", header)
	}
}

func TestExportSQLEscapesIdentifiers(t *testing.T) {
	r := &database.QueryResult{
		Columns:   []string{`wei"rd`},
		Rows:      [][]interface{}{{int64(1)}},
		TableName: `tab"le`,
	}
	got, err := ExportResult(r, "sql")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if !strings.Contains(got, `INSERT INTO "tab""le" ("wei""rd")`) {
		t.Fatalf("expected escaped identifiers, got: %s", got)
	}
}

func TestExportSQLUnsignedInteger(t *testing.T) {
	r := &database.QueryResult{
		Columns:   []string{"n"},
		Rows:      [][]interface{}{{uint64(18446744073709551615)}},
		TableName: "t",
	}
	got, err := ExportResult(r, "sql")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	// uint64 must be emitted as a bare numeric literal, not quoted as a string.
	if !strings.Contains(got, "VALUES (18446744073709551615)") {
		t.Fatalf("expected unquoted unsigned int, got: %s", got)
	}
}

func TestExportCSVDefusesFormulaInjection(t *testing.T) {
	r := &database.QueryResult{
		Columns: []string{"v"},
		Rows:    [][]interface{}{{"=1+1"}, {"@SUM(A1)"}, {"-5"}, {"plain"}},
	}
	got, err := ExportResult(r, "csv")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	lines := strings.Split(got, "\n")
	if lines[1] != "'=1+1" {
		t.Fatalf("expected defused =, got: %q", lines[1])
	}
	if lines[2] != "'@SUM(A1)" {
		t.Fatalf("expected defused @, got: %q", lines[2])
	}
	if lines[3] != "-5" { // negative number must not be defused
		t.Fatalf("negative number should be untouched, got: %q", lines[3])
	}
	if lines[4] != "plain" {
		t.Fatalf("plain text should be untouched, got: %q", lines[4])
	}
}

func TestExportMarkdownFlattensCarriageReturns(t *testing.T) {
	r := &database.QueryResult{
		Columns: []string{"v"},
		Rows:    [][]interface{}{{"a\r\nb"}, {"c\rd"}},
	}
	got, err := ExportResult(r, "markdown")
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if strings.Contains(got, "\r") {
		t.Fatalf("markdown must not contain carriage returns, got: %q", got)
	}
	if !strings.Contains(got, "| a b |") || !strings.Contains(got, "| c d |") {
		t.Fatalf("expected flattened cells, got: %s", got)
	}
}

func TestExportUnsupportedFormat(t *testing.T) {
	if _, err := ExportResult(sampleResult(), "xml"); err == nil {
		t.Fatal("expected error for unsupported format")
	}
}

func TestExportFormatIsCaseInsensitive(t *testing.T) {
	if _, err := ExportResult(sampleResult(), "JSON"); err != nil {
		t.Fatalf("JSON (uppercase) should work: %v", err)
	}
}
