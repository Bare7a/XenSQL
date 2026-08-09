package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"xensql/internal/service"
)

func importFixture(t *testing.T, filename, content string) (*App, string, string) {
	t.Helper()
	a := appForTest(t)
	saved, err := a.SaveConnection(sqliteConn(t))
	if err != nil {
		t.Fatalf("save connection: %v", err)
	}
	path := filepath.Join(t.TempDir(), filename)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	t.Cleanup(func() { a.pool.CloseAll() })
	return a, saved.ID, path
}

// Production runs this on a goroutine; driving the core directly makes the result observable.
func runCSV(t *testing.T, a *App, connID string, req CSVImportRequest) *ImportResult {
	t.Helper()
	targets, sources, err := resolveMapping(req.Mapping)
	if err != nil {
		t.Fatalf("resolveMapping: %v", err)
	}
	em := &importEmitter{app: a, importID: "test"}
	result, err := a.runCSVImport(context.Background(), em, connID, req, targets, sources)
	if err != nil {
		t.Fatalf("runCSVImport: %v", err)
	}
	return result
}

func queryAll(t *testing.T, a *App, connID, sql string) [][]string {
	t.Helper()
	res, err := a.ExecuteQuery(connID, sql)
	if err != nil {
		t.Fatalf("query %q: %v", sql, err)
	}
	out := make([][]string, 0, len(res.Rows))
	for _, row := range res.Rows {
		cells := make([]string, len(row))
		for i, v := range row {
			if v == nil {
				cells[i] = "<nil>"
				continue
			}
			if b, ok := v.([]byte); ok {
				cells[i] = string(b)
				continue
			}
			cells[i] = fmt.Sprint(v)
		}
		out = append(out, cells)
	}
	return out
}

func TestImportCSVCreatesTableAndLoadsRows(t *testing.T) {
	csv := "id,name,score\n1,Alice,9.5\n2,Bob,7\n3,Carol,8.25\n"
	a, connID, path := importFixture(t, "people.csv", csv)

	result := runCSV(t, a, connID, CSVImportRequest{
		Path:        path,
		Table:       "people",
		CreateTable: true,
		Options:     service.CSVOptions{HasHeader: true},
		Mapping:     []string{"id", "name", "score"},
		ColumnTypes: []string{"int", "text", "float"},
	})

	if result.Inserted != 3 || result.Skipped != 0 {
		t.Fatalf("result = %+v, want 3 inserted", result)
	}
	rows := queryAll(t, a, connID, "SELECT name FROM people ORDER BY id")
	if len(rows) != 3 {
		t.Fatalf("expected 3 rows, got %d: %v", len(rows), rows)
	}
	if rows[0][0] != "Alice" || rows[2][0] != "Carol" {
		t.Errorf("rows = %v", rows)
	}

	cols, err := a.ListColumns(connID, "main", "people")
	if err != nil {
		t.Fatalf("ListColumns: %v", err)
	}
	types := map[string]string{}
	for _, c := range cols {
		types[c.Name] = strings.ToUpper(c.DataType)
	}
	if types["id"] != "INTEGER" {
		t.Errorf("id column type = %q, want INTEGER", types["id"])
	}
	if types["score"] != "REAL" {
		t.Errorf("score column type = %q, want REAL", types["score"])
	}
}

func TestImportCSVSkipsUnmappedColumns(t *testing.T) {
	csv := "id,name,ignored\n1,Alice,junk\n2,Bob,junk\n"
	a, connID, path := importFixture(t, "people.csv", csv)
	mustExecSQL(t, a, connID, "CREATE TABLE people (id INTEGER, name TEXT)")

	result := runCSV(t, a, connID, CSVImportRequest{
		Path:    path,
		Table:   "people",
		Options: service.CSVOptions{HasHeader: true},
		Mapping: []string{"id", "name", ""},
	})
	if result.Inserted != 2 {
		t.Fatalf("result = %+v, want 2 inserted", result)
	}
	rows := queryAll(t, a, connID, "SELECT name FROM people ORDER BY id")
	if len(rows) != 2 || rows[0][0] != "Alice" {
		t.Errorf("rows = %v", rows)
	}
}

func TestImportCSVTreatsBlanksAndNullLiteralAsNull(t *testing.T) {
	csv := "id,name\n1,\n2,\\N\n3,Carol\n"
	a, connID, path := importFixture(t, "people.csv", csv)
	mustExecSQL(t, a, connID, "CREATE TABLE people (id INTEGER, name TEXT)")

	result := runCSV(t, a, connID, CSVImportRequest{
		Path:    path,
		Table:   "people",
		Options: service.CSVOptions{HasHeader: true, NullLiteral: `\N`},
		Mapping: []string{"id", "name"},
	})
	if result.Inserted != 3 {
		t.Fatalf("result = %+v", result)
	}
	rows := queryAll(t, a, connID, "SELECT COUNT(*) FROM people WHERE name IS NULL")
	if rows[0][0] != "2" {
		t.Errorf("expected 2 NULL names, got %v", rows)
	}
}

func TestImportCSVSkipsBadRowsAndReportsThem(t *testing.T) {
	csv := "id,name\n1,Alice\n2,Bob\n,Carol\n4,Dave\n"
	a, connID, path := importFixture(t, "people.csv", csv)
	mustExecSQL(t, a, connID, "CREATE TABLE people (id INTEGER NOT NULL, name TEXT)")

	result := runCSV(t, a, connID, CSVImportRequest{
		Path:      path,
		Table:     "people",
		Options:   service.CSVOptions{HasHeader: true},
		Mapping:   []string{"id", "name"},
		BatchSize: 10,
	})
	if result.Inserted != 3 || result.Skipped != 1 {
		t.Fatalf("result = %+v, want 3 inserted / 1 skipped", result)
	}
	if len(result.Errors) == 0 {
		t.Error("a skipped row should be explained")
	}
	rows := queryAll(t, a, connID, "SELECT COUNT(*) FROM people")
	if rows[0][0] != "3" {
		t.Errorf("expected 3 surviving rows, got %v", rows)
	}
}

func TestImportCSVStopOnErrorAborts(t *testing.T) {
	csv := "id,name\n1,Alice\n,Bob\n3,Carol\n"
	a, connID, path := importFixture(t, "people.csv", csv)
	mustExecSQL(t, a, connID, "CREATE TABLE people (id INTEGER NOT NULL, name TEXT)")

	targets, sources, err := resolveMapping([]string{"id", "name"})
	if err != nil {
		t.Fatalf("resolveMapping: %v", err)
	}
	em := &importEmitter{app: a, importID: "test"}
	_, err = a.runCSVImport(context.Background(), em, connID, CSVImportRequest{
		Path:        path,
		Table:       "people",
		Options:     service.CSVOptions{HasHeader: true},
		Mapping:     []string{"id", "name"},
		BatchSize:   1,
		StopOnError: true,
	}, targets, sources)
	if err == nil {
		t.Fatal("expected the import to abort on the bad row")
	}
	// Batches autocommit, so rows before the failure stay: partial, not atomic.
	rows := queryAll(t, a, connID, "SELECT COUNT(*) FROM people")
	if rows[0][0] != "1" {
		t.Errorf("expected the first row to have been committed, got %v", rows)
	}
}

func TestImportCSVTruncatesExistingRows(t *testing.T) {
	csv := "id,name\n9,Zoe\n"
	a, connID, path := importFixture(t, "people.csv", csv)
	mustExecSQL(t, a, connID, "CREATE TABLE people (id INTEGER, name TEXT)")
	mustExecSQL(t, a, connID, "INSERT INTO people (id, name) VALUES (1, 'Old')")

	result := runCSV(t, a, connID, CSVImportRequest{
		Path:     path,
		Table:    "people",
		Truncate: true,
		Options:  service.CSVOptions{HasHeader: true},
		Mapping:  []string{"id", "name"},
	})
	if result.Inserted != 1 {
		t.Fatalf("result = %+v", result)
	}
	rows := queryAll(t, a, connID, "SELECT name FROM people")
	if len(rows) != 1 || rows[0][0] != "Zoe" {
		t.Errorf("truncate should have removed the old row, got %v", rows)
	}
}

func TestImportCSVHeaderlessFile(t *testing.T) {
	a, connID, path := importFixture(t, "people.csv", "1,Alice\n2,Bob\n")
	result := runCSV(t, a, connID, CSVImportRequest{
		Path:        path,
		Table:       "people",
		CreateTable: true,
		Options:     service.CSVOptions{HasHeader: false},
		Mapping:     []string{"col1", "col2"},
		ColumnTypes: []string{"int", "text"},
	})
	if result.Inserted != 2 {
		t.Fatalf("result = %+v", result)
	}
	rows := queryAll(t, a, connID, "SELECT col2 FROM people ORDER BY col1")
	if len(rows) != 2 || rows[0][0] != "Alice" {
		t.Errorf("rows = %v", rows)
	}
}

func TestImportCSVNormalizesBooleans(t *testing.T) {
	csv := "id,active\n1,true\n2,no\n3,Y\n"
	a, connID, path := importFixture(t, "flags.csv", csv)

	result := runCSV(t, a, connID, CSVImportRequest{
		Path:        path,
		Table:       "flags",
		CreateTable: true,
		Options:     service.CSVOptions{HasHeader: true},
		Mapping:     []string{"id", "active"},
		ColumnTypes: []string{"int", "bool"},
	})
	if result.Inserted != 3 {
		t.Fatalf("result = %+v", result)
	}
	rows := queryAll(t, a, connID, "SELECT COUNT(*) FROM flags WHERE active = 1")
	if rows[0][0] != "2" {
		t.Errorf("expected 2 truthy rows, got %v", rows)
	}
}

func TestResolveMapping(t *testing.T) {
	targets, sources, err := resolveMapping([]string{"id", "", "name", "  "})
	if err != nil {
		t.Fatalf("resolveMapping: %v", err)
	}
	if strings.Join(targets, ",") != "id,name" {
		t.Errorf("targets = %v", targets)
	}
	if len(sources) != 2 || sources[0] != 0 || sources[1] != 2 {
		t.Errorf("sources = %v, want [0 2]", sources)
	}

	if _, _, err := resolveMapping([]string{"id", "ID"}); err == nil {
		t.Error("a column mapped twice should be rejected")
	}
	if _, _, err := resolveMapping([]string{"", ""}); err == nil {
		t.Error("an empty mapping should be rejected")
	}
}

func TestNormalizeBool(t *testing.T) {
	for _, v := range []string{"true", "T", "yes", "Y", "1"} {
		if got := normalizeBool(v, false); got != 1 {
			t.Errorf("normalizeBool(%q, false) = %v, want 1", v, got)
		}
		if got := normalizeBool(v, true); got != true {
			t.Errorf("normalizeBool(%q, true) = %v, want true", v, got)
		}
	}
	for _, v := range []string{"false", "F", "no", "N", "0"} {
		if got := normalizeBool(v, false); got != 0 {
			t.Errorf("normalizeBool(%q, false) = %v, want 0", v, got)
		}
		if got := normalizeBool(v, true); got != false {
			t.Errorf("normalizeBool(%q, true) = %v, want false", v, got)
		}
	}
	if got := normalizeBool("maybe", true); got != "maybe" {
		t.Errorf("normalizeBool(\"maybe\") = %v, want it unchanged", got)
	}
}

func TestPreviewImportFile(t *testing.T) {
	csv := "id;name;joined\n1;Alice;2026-01-02\n2;Bob;2026-03-04\n"
	a, connID, path := importFixture(t, "people.csv", csv)

	preview, err := a.PreviewImportFile(connID, path, service.CSVOptions{HasHeader: true})
	if err != nil {
		t.Fatalf("PreviewImportFile: %v", err)
	}
	if strings.Join(preview.Columns, ",") != "id,name,joined" {
		t.Errorf("columns = %v", preview.Columns)
	}
	if preview.Delimiter != ";" {
		t.Errorf("delimiter = %q, want ';'", preview.Delimiter)
	}
	if len(preview.Rows) != 2 {
		t.Fatalf("rows = %v", preview.Rows)
	}
	if strings.Join(preview.InferredTypes, ",") != "int,text,date" {
		t.Errorf("inferred types = %v", preview.InferredTypes)
	}
	if strings.Join(preview.SQLTypes, ",") != "INTEGER,TEXT,TEXT" {
		t.Errorf("sql types = %v", preview.SQLTypes)
	}
	if preview.Truncated {
		t.Error("a 2-row file should not report truncation")
	}
	if preview.TotalRows != 2 {
		t.Errorf("totalRows = %d, want 2", preview.TotalRows)
	}
}

// The count must cover the whole file, not just the preview sample.
func TestPreviewImportFileCountsEveryRow(t *testing.T) {
	var b strings.Builder
	b.WriteString("id,name\n")
	for i := 1; i <= previewRowLimit*3; i++ {
		fmt.Fprintf(&b, "%d,name%d\n", i, i)
	}
	a, connID, path := importFixture(t, "people.csv", b.String())

	preview, err := a.PreviewImportFile(connID, path, service.CSVOptions{HasHeader: true})
	if err != nil {
		t.Fatalf("PreviewImportFile: %v", err)
	}
	if len(preview.Rows) != previewRowLimit || !preview.Truncated {
		t.Errorf("sample = %d rows, truncated = %v", len(preview.Rows), preview.Truncated)
	}
	if preview.TotalRows != int64(previewRowLimit*3) {
		t.Errorf("totalRows = %d, want %d", preview.TotalRows, previewRowLimit*3)
	}
}

// An unterminated quote is data under lazy quoting, counted like the import will load it.
func TestPreviewImportFileCountsLazyQuotedRows(t *testing.T) {
	csv := "id,name\n1,Alice\n2,\"unterminated\n"
	a, connID, path := importFixture(t, "people.csv", csv)

	preview, err := a.PreviewImportFile(connID, path, service.CSVOptions{HasHeader: true})
	if err != nil {
		t.Fatalf("PreviewImportFile: %v", err)
	}
	if preview.TotalRows != 2 {
		t.Errorf("totalRows = %d, want 2", preview.TotalRows)
	}
}

func TestPreviewImportFileHeaderOnlyCountsNoRows(t *testing.T) {
	a, connID, path := importFixture(t, "people.csv", "id,name\n")
	preview, err := a.PreviewImportFile(connID, path, service.CSVOptions{HasHeader: true})
	if err != nil {
		t.Fatalf("PreviewImportFile: %v", err)
	}
	if preview.TotalRows != 0 {
		t.Errorf("totalRows = %d, want 0", preview.TotalRows)
	}
}

// The row target rides on every progress event.
func TestImportCSVReportsRowTarget(t *testing.T) {
	csv := "id,name\n1,Alice\n2,Bob\n3,Carol\n"
	a, connID, path := importFixture(t, "people.csv", csv)
	mustExecSQL(t, a, connID, "CREATE TABLE people (id INTEGER, name TEXT)")

	targets, sources, err := resolveMapping([]string{"id", "name"})
	if err != nil {
		t.Fatalf("resolveMapping: %v", err)
	}
	em := &importEmitter{app: a, importID: "test"}
	if _, err = a.runCSVImport(context.Background(), em, connID, CSVImportRequest{
		Path:    path,
		Table:   "people",
		Options: service.CSVOptions{HasHeader: true},
		Mapping: []string{"id", "name"},
	}, targets, sources); err != nil {
		t.Fatalf("runCSVImport: %v", err)
	}
	if em.totalRows != 3 {
		t.Errorf("emitter totalRows = %d, want 3", em.totalRows)
	}
}

func TestPreviewImportFileWithoutHeader(t *testing.T) {
	a, connID, path := importFixture(t, "people.csv", "1,Alice\n2,Bob\n")
	preview, err := a.PreviewImportFile(connID, path, service.CSVOptions{HasHeader: false})
	if err != nil {
		t.Fatalf("PreviewImportFile: %v", err)
	}
	if strings.Join(preview.Columns, ",") != "col1,col2" {
		t.Errorf("columns = %v", preview.Columns)
	}
	if len(preview.Rows) != 2 || preview.Rows[0][1] != "Alice" {
		t.Errorf("rows = %v", preview.Rows)
	}
}

func TestPreviewImportFileRejectsEmptyFile(t *testing.T) {
	a, connID, path := importFixture(t, "empty.csv", "")
	if _, err := a.PreviewImportFile(connID, path, service.CSVOptions{HasHeader: true}); err == nil {
		t.Error("expected an error for an empty file")
	}
}

func TestImportSQLRunsEveryStatement(t *testing.T) {
	script := `CREATE TABLE t (id INTEGER, name TEXT);
INSERT INTO t (id, name) VALUES (1, 'Alice');
INSERT INTO t (id, name) VALUES (2, 'Bob');
`
	a, connID, path := importFixture(t, "dump.sql", script)

	em := &importEmitter{app: a, importID: "test"}
	result, err := a.runSQLImport(context.Background(), em, connID, SQLImportRequest{Path: path})
	if err != nil {
		t.Fatalf("runSQLImport: %v", err)
	}
	if result.Statements != 3 || result.Skipped != 0 {
		t.Fatalf("result = %+v, want 3 statements", result)
	}
	rows := queryAll(t, a, connID, "SELECT COUNT(*) FROM t")
	if rows[0][0] != "2" {
		t.Errorf("expected 2 rows, got %v", rows)
	}
}

func TestImportSQLContinuesPastFailure(t *testing.T) {
	script := `CREATE TABLE t (id INTEGER);
INSERT INTO nonexistent (id) VALUES (1);
INSERT INTO t (id) VALUES (2);
`
	a, connID, path := importFixture(t, "dump.sql", script)

	em := &importEmitter{app: a, importID: "test"}
	result, err := a.runSQLImport(context.Background(), em, connID, SQLImportRequest{Path: path})
	if err != nil {
		t.Fatalf("runSQLImport: %v", err)
	}
	if result.Statements != 2 || result.Skipped != 1 {
		t.Fatalf("result = %+v, want 2 ok / 1 skipped", result)
	}
	if len(result.Errors) == 0 || !strings.Contains(result.Errors[0], "statement 2") {
		t.Errorf("the failing statement should be identified, got %v", result.Errors)
	}
}

func TestImportSQLStopOnErrorAborts(t *testing.T) {
	script := "CREATE TABLE t (id INTEGER);\nINSERT INTO nope (id) VALUES (1);\nINSERT INTO t (id) VALUES (2);\n"
	a, connID, path := importFixture(t, "dump.sql", script)

	em := &importEmitter{app: a, importID: "test"}
	if _, err := a.runSQLImport(context.Background(), em, connID, SQLImportRequest{
		Path: path, StopOnError: true,
	}); err == nil {
		t.Fatal("expected the import to abort")
	}
	rows := queryAll(t, a, connID, "SELECT COUNT(*) FROM t")
	if rows[0][0] != "0" {
		t.Errorf("expected no rows after the abort, got %v", rows)
	}
}

func TestImportRejectsReadOnlyConnection(t *testing.T) {
	a := appForTest(t)
	cfg := sqliteConn(t)
	cfg.ReadOnly = true
	saved, err := a.SaveConnection(cfg)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	t.Cleanup(func() { a.pool.CloseAll() })

	if err := a.ImportCSV(saved.ID, "id-1", CSVImportRequest{
		Path: "x.csv", Table: "t", Mapping: []string{"a"},
	}); err == nil {
		t.Error("a read-only connection must refuse a CSV import")
	}
	if err := a.ImportSQL(saved.ID, "id-2", SQLImportRequest{Path: "x.sql"}); err == nil {
		t.Error("a read-only connection must refuse a SQL import")
	}
}

func TestImportValidatesRequest(t *testing.T) {
	a, connID, path := importFixture(t, "people.csv", "id\n1\n")
	tests := []struct {
		name string
		id   string
		req  CSVImportRequest
	}{
		{"missing import id", "", CSVImportRequest{Path: path, Table: "t", Mapping: []string{"id"}}},
		{"missing path", "i", CSVImportRequest{Table: "t", Mapping: []string{"id"}}},
		{"missing table", "i", CSVImportRequest{Path: path, Mapping: []string{"id"}}},
		{"no mapped columns", "i", CSVImportRequest{Path: path, Table: "t"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := a.ImportCSV(connID, tc.id, tc.req); err == nil {
				t.Error("expected a validation error")
			}
		})
	}
}

func mustExecSQL(t *testing.T, a *App, connID, sql string) {
	t.Helper()
	if _, err := a.ExecuteQuery(connID, sql); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

// Bare empty field → NULL; quoted → ”. This is what re-imports into a NOT NULL column.
func TestImportCSVKeepsQuotedEmptyStringApartFromNull(t *testing.T) {
	csv := "id,a,b\n1,,\"\"\n"
	a, connID, path := importFixture(t, "blanks.csv", csv)
	mustExecSQL(t, a, connID, "CREATE TABLE t (id INTEGER, a TEXT, b TEXT NOT NULL)")

	result := runCSV(t, a, connID, CSVImportRequest{
		Path:    path,
		Table:   "t",
		Options: service.CSVOptions{HasHeader: true},
		Mapping: []string{"id", "a", "b"},
	})
	if result.Inserted != 1 || result.Skipped != 0 {
		t.Fatalf("result = %+v, want 1 inserted", result)
	}
	rows := queryAll(t, a, connID, "SELECT a IS NULL, b IS NULL, b FROM t")
	if rows[0][0] != "1" {
		t.Errorf("bare empty field should be NULL, got %v", rows[0])
	}
	if rows[0][1] != "0" || rows[0][2] != "" {
		t.Errorf("quoted empty field should be an empty string, got %v", rows[0])
	}
}

func TestImportCSVStripsFormulaGuardApostrophe(t *testing.T) {
	csv := "v\n'=1+1\n'@handle\n'-not a number\n'plain\nO'Brien\n"
	a, connID, path := importFixture(t, "formulas.csv", csv)
	mustExecSQL(t, a, connID, "CREATE TABLE t (v TEXT)")

	result := runCSV(t, a, connID, CSVImportRequest{
		Path:    path,
		Table:   "t",
		Options: service.CSVOptions{HasHeader: true},
		Mapping: []string{"v"},
	})
	if result.Inserted != 5 {
		t.Fatalf("result = %+v", result)
	}
	rows := queryAll(t, a, connID, "SELECT v FROM t")
	got := make([]string, 0, len(rows))
	for _, r := range rows {
		got = append(got, r[0])
	}
	want := []string{"=1+1", "@handle", "-not a number", "'plain", "O'Brien"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("values = %v, want %v", got, want)
	}
}

func TestImportCSVNullLiteralBeatsQuoting(t *testing.T) {
	csv := "v\n\"\\N\"\n"
	a, connID, path := importFixture(t, "nulls.csv", csv)
	mustExecSQL(t, a, connID, "CREATE TABLE t (v TEXT)")

	result := runCSV(t, a, connID, CSVImportRequest{
		Path:    path,
		Table:   "t",
		Options: service.CSVOptions{HasHeader: true, NullLiteral: `\N`},
		Mapping: []string{"v"},
	})
	if result.Inserted != 1 {
		t.Fatalf("result = %+v", result)
	}
	rows := queryAll(t, a, connID, "SELECT v IS NULL FROM t")
	if rows[0][0] != "1" {
		t.Errorf("the NULL literal should win over quoting, got %v", rows[0])
	}
}

func TestImportCSVBoolShapedTextStaysText(t *testing.T) {
	a, connID, path := importFixture(t, "flags.csv", "v\ntrue\nf\n")
	mustExecSQL(t, a, connID, "CREATE TABLE t (v TEXT)")

	result := runCSV(t, a, connID, CSVImportRequest{
		Path:        path,
		Table:       "t",
		Options:     service.CSVOptions{HasHeader: true},
		Mapping:     []string{"v"},
		ColumnTypes: []string{"bool"},
	})
	if result.Inserted != 2 {
		t.Fatalf("result = %+v", result)
	}
	rows := queryAll(t, a, connID, "SELECT v FROM t ORDER BY rowid")
	if rows[0][0] != "true" || rows[1][0] != "f" {
		t.Errorf("values = %v, want [true f]", rows)
	}
}
