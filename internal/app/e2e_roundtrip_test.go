//go:build e2e

// Export → re-import round trips: NULL vs ” quoting, the formula guard, MySQL datetime literals.
package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"xensql/internal/database"
	"xensql/internal/service"
)

// Imports the way the dialog does: self-mapped, with the preview's inferred types.
func importCSVInto(t *testing.T, a *App, connID, schema, table string, columns []string, path string) *ImportResult {
	t.Helper()
	preview, err := a.PreviewImportFile(connID, path, service.CSVOptions{HasHeader: true})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	targets, sources, err := resolveMapping(columns)
	if err != nil {
		t.Fatalf("resolveMapping: %v", err)
	}
	em := &importEmitter{app: a, importID: "roundtrip"}
	result, err := a.runCSVImport(testCtx(), em, connID, CSVImportRequest{
		Path:        path,
		Schema:      schema,
		Table:       table,
		Options:     service.CSVOptions{HasHeader: true},
		Mapping:     columns,
		ColumnTypes: preview.InferredTypes,
	}, targets, sources)
	if err != nil {
		t.Fatalf("import aborted: %v", err)
	}
	return result
}

func writeExportedCSV(t *testing.T, result *database.QueryResult) string {
	t.Helper()
	csv, err := service.ExportResult(result, "csv")
	if err != nil {
		t.Fatalf("ExportResult: %v", err)
	}
	path := filepath.Join(t.TempDir(), "export.csv")
	if err := os.WriteFile(path, []byte(csv+"\n"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	return path
}

func TestRoundTripExportThenImport(t *testing.T) {
	for _, e := range allEngines() {
		t.Run(e.name, func(t *testing.T) {
			a := appForTest(t)
			connID := requireEngine(t, a, e)

			src, dst := "e2e_rt_src", "e2e_rt_dst"
			boolType := "TINYINT(1)"
			if e.driver == database.DriverPostgres {
				boolType = "BOOLEAN"
			}
			ddl := fmt.Sprintf(`CREATE TABLE %%s (
				id INT,
				nullable_text TEXT,
				empty_text TEXT NOT NULL,
				payload %s,
				amount DECIMAL(10,2),
				flag %s,
				note TEXT
			)`, e.jsonType, boolType)
			for _, tbl := range []string{src, dst} {
				mustExecSQL(t, a, connID, "DROP TABLE IF EXISTS "+tbl)
				mustExecSQL(t, a, connID, fmt.Sprintf(ddl, tbl))
			}

			mustExecSQL(t, a, connID, fmt.Sprintf(
				`INSERT INTO %s (id, nullable_text, empty_text, payload, amount, flag, note) VALUES
					(1, NULL, '', '{"a": 1, "b": [true, null]}', 12.34, TRUE, 'plain'),
					(2, 'set', 'x', '{"nested": {"k": "v, with comma"}}', NULL, FALSE, ''),
					(3, NULL, '', 'null', 0.00, NULL, '-not a number')`, src))

			cols := []string{"id", "nullable_text", "empty_text", "payload", "amount", "flag", "note"}
			selectAll := fmt.Sprintf("SELECT %s FROM %%s ORDER BY id", strings.Join(cols, ", "))
			before, err := a.ExecuteQuery(connID, fmt.Sprintf(selectAll, src))
			if err != nil {
				t.Fatalf("select: %v", err)
			}

			result := importCSVInto(t, a, connID, e.browseSchema, dst, cols, writeExportedCSV(t, before))
			if result.Skipped > 0 {
				t.Fatalf("%d of 3 rows were rejected: %s", result.Skipped, first(result.Errors))
			}

			after, err := a.ExecuteQuery(connID, fmt.Sprintf(selectAll, dst))
			if err != nil {
				t.Fatalf("select back: %v", err)
			}
			if got, want := fmt.Sprintf("%#v", after.Rows), fmt.Sprintf("%#v", before.Rows); got != want {
				t.Errorf("round trip changed the rows\n got %s\nwant %s", got, want)
			}
		})
	}
}

// One column per case, so a failure names the value shape that broke.
func TestRoundTripValueShapes(t *testing.T) {
	cases := []struct {
		col     string
		pgType  string
		myType  string
		valExpr string
	}{
		{"c_null_text", "TEXT", "TEXT", "NULL"},
		{"c_empty_text", "TEXT", "TEXT", "''"},
		{"c_json_obj", "JSONB", "JSON", `'{"k": "v"}'`},
		{"c_json_arr", "JSONB", "JSON", `'[1, 2, {"a": null}]'`},
		{"c_json_null", "JSONB", "JSON", `'null'`},
		{"c_json_str", "JSONB", "JSON", `'"just a string"'`},
		{"c_json_empty_str", "JSONB", "JSON", `'""'`},
		{"c_json_sqlnull", "JSONB", "JSON", "NULL"},
		{"c_blob", "BYTEA", "BLOB", `'abc'`},
		{"c_bool_on", "BOOLEAN", "TINYINT(1)", "TRUE"},
		{"c_bool_off", "BOOLEAN", "TINYINT(1)", "FALSE"},
		{"c_bool_null", "BOOLEAN", "TINYINT(1)", "NULL"},
		{"c_num_null", "DECIMAL(10,2)", "DECIMAL(10,2)", "NULL"},
		{"c_ts", "TIMESTAMP", "DATETIME", "'2026-08-09 12:34:56'"},
		{"c_ts_null", "TIMESTAMP", "DATETIME", "NULL"},
		{"c_date", "DATE", "DATE", "'2026-08-09'"},
		{"c_dash_text", "TEXT", "TEXT", "'-not a number'"},
		{"c_at_text", "TEXT", "TEXT", "'@handle'"},
		{"c_plus_text", "TEXT", "TEXT", "'+44 20 7946 0000'"},
		{"c_eq_text", "TEXT", "TEXT", "'=1+2'"},
		{"c_ws_text", "TEXT", "TEXT", "'  leading spaces'"},
		{"c_quote_text", "TEXT", "TEXT", `'say "hi", twice'`},
		{"c_newline_text", "TEXT", "TEXT", "'two" + "\n" + "lines'"},
	}

	for _, e := range allEngines() {
		t.Run(e.name, func(t *testing.T) {
			a := appForTest(t)
			connID := requireEngine(t, a, e)

			// rid keeps a NULL-only row from exporting as a blank line, which CSV skips.
			cols := []string{"rid"}
			defs := []string{"rid INT"}
			vals := []string{"1"}
			for _, c := range cases {
				colType := c.myType
				if e.driver == database.DriverPostgres {
					colType = c.pgType
				}
				cols = append(cols, c.col)
				defs = append(defs, c.col+" "+colType)
				vals = append(vals, c.valExpr)
			}

			src, dst := "e2e_rt2_src", "e2e_rt2_dst"
			for _, tbl := range []string{src, dst} {
				mustExecSQL(t, a, connID, "DROP TABLE IF EXISTS "+tbl)
				mustExecSQL(t, a, connID, fmt.Sprintf("CREATE TABLE %s (%s)", tbl, strings.Join(defs, ", ")))
			}
			mustExecSQL(t, a, connID, fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
				src, strings.Join(cols, ", "), strings.Join(vals, ", ")))

			before, err := a.ExecuteQuery(connID, fmt.Sprintf("SELECT %s FROM %s", strings.Join(cols, ", "), src))
			if err != nil {
				t.Fatalf("select: %v", err)
			}

			for i, c := range cases {
				pair := []string{"rid", c.col}
				single := &database.QueryResult{Columns: pair, Rows: [][]any{{before.Rows[0][0], before.Rows[0][i+1]}}}
				mustExecSQL(t, a, connID, "DELETE FROM "+dst)

				result := importCSVInto(t, a, connID, e.browseSchema, dst, pair, writeExportedCSV(t, single))
				if result.Skipped > 0 {
					t.Errorf("%-18s rejected: %s", c.col, first(result.Errors))
					continue
				}
				back, bErr := a.ExecuteQuery(connID, fmt.Sprintf("SELECT %s FROM %s", c.col, dst))
				if bErr != nil {
					t.Fatalf("read back: %v", bErr)
				}
				got, want := back.Rows[0][0], before.Rows[0][i+1]
				if fmt.Sprintf("%#v", got) != fmt.Sprintf("%#v", want) {
					t.Errorf("%-18s changed: %#v -> %#v", c.col, want, got)
				}
			}
		})
	}
}

// A source that quotes every field must still load: ” only lands where the column can hold one.
func TestImportQuotedEmptyFieldsByColumnType(t *testing.T) {
	for _, e := range allEngines() {
		t.Run(e.name, func(t *testing.T) {
			a := appForTest(t)
			connID := requireEngine(t, a, e)

			tsType := "DATETIME"
			if e.driver == database.DriverPostgres {
				tsType = "TIMESTAMP"
			}
			tbl := "e2e_quoted_all"
			mustExecSQL(t, a, connID, "DROP TABLE IF EXISTS "+tbl)
			mustExecSQL(t, a, connID, fmt.Sprintf(
				"CREATE TABLE %s (n INT, amount DECIMAL(10,2), when_ts %s, note TEXT)", tbl, tsType))

			path := filepath.Join(t.TempDir(), "quoted.csv")
			if err := os.WriteFile(path, []byte("\"n\",\"amount\",\"when_ts\",\"note\"\n\"1\",\"\",\"\",\"\"\n"), 0o600); err != nil {
				t.Fatalf("write: %v", err)
			}

			cols := []string{"n", "amount", "when_ts", "note"}
			if result := importCSVInto(t, a, connID, e.browseSchema, tbl, cols, path); result.Skipped > 0 {
				t.Fatalf("rejected: %s", first(result.Errors))
			}

			back, err := a.ExecuteQuery(connID, fmt.Sprintf("SELECT amount, when_ts, note FROM %s", tbl))
			if err != nil {
				t.Fatalf("read back: %v", err)
			}
			row := back.Rows[0]
			if row[0] != nil || row[1] != nil {
				t.Errorf("numeric and date blanks should be NULL, got %#v and %#v", row[0], row[1])
			}
			if row[2] != "" {
				t.Errorf("a text blank should stay an empty string, got %#v", row[2])
			}
		})
	}
}

// Bool-shaped columns land per target: engine bools, 1/0 into numerics, untouched text.
func TestImportBoolShapedColumns(t *testing.T) {
	for _, e := range allEngines() {
		t.Run(e.name, func(t *testing.T) {
			a := appForTest(t)
			connID := requireEngine(t, a, e)

			boolType := "TINYINT(1)"
			if e.driver == database.DriverPostgres {
				boolType = "BOOLEAN"
			}
			tbl := "e2e_bool_targets"
			mustExecSQL(t, a, connID, "DROP TABLE IF EXISTS "+tbl)
			mustExecSQL(t, a, connID, fmt.Sprintf(
				"CREATE TABLE %s (rid INT, flag %s, hits INT, note TEXT)", tbl, boolType))

			csv := "rid,flag,hits,note\n1,1,1,true\n2,0,0,false\n3,true,1,t\n4,false,0,f\n"
			path := filepath.Join(t.TempDir(), "bools.csv")
			if err := os.WriteFile(path, []byte(csv), 0o600); err != nil {
				t.Fatalf("write: %v", err)
			}

			cols := []string{"rid", "flag", "hits", "note"}
			if result := importCSVInto(t, a, connID, e.browseSchema, tbl, cols, path); result.Skipped > 0 {
				t.Fatalf("rejected %d rows: %s", result.Skipped, first(result.Errors))
			}

			back, err := a.ExecuteQuery(connID, fmt.Sprintf(
				"SELECT COUNT(*) FROM %s WHERE flag = TRUE", tbl))
			if err != nil {
				t.Fatalf("read back: %v", err)
			}
			if got := fmt.Sprint(back.Rows[0][0]); got != "2" {
				t.Errorf("true flags = %s, want 2", got)
			}
			notes, err := a.ExecuteQuery(connID, fmt.Sprintf(
				"SELECT note FROM %s ORDER BY rid", tbl))
			if err != nil {
				t.Fatalf("read notes: %v", err)
			}
			want := []string{"true", "false", "t", "f"}
			for i, row := range notes.Rows {
				if fmt.Sprint(row[0]) != want[i] {
					t.Errorf("note[%d] = %#v, want %q (bool-shaped text must stay text)", i, row[0], want[i])
				}
			}
		})
	}
}

func first(errs []string) string {
	if len(errs) == 0 {
		return "(no message)"
	}
	return errs[0]
}

// The field-reported failing table, faithful DDL: custom enum arrays, self-FK, PK, unique.
func TestImportPostgresRealWorldRow(t *testing.T) {
	e := pgEngine()
	a := appForTest(t)
	connID := requireEngine(t, a, e)

	tbl := "e2e_users_real"
	mustExecSQL(t, a, connID, "DROP TABLE IF EXISTS "+tbl)
	mustExecSQL(t, a, connID, "DROP TYPE IF EXISTS e2e_user_scopes CASCADE")
	mustExecSQL(t, a, connID, "DROP TYPE IF EXISTS e2e_permissions CASCADE")
	mustExecSQL(t, a, connID, "CREATE TYPE e2e_user_scopes AS ENUM ('compliance', 'audit', 'billing')")
	mustExecSQL(t, a, connID, "CREATE TYPE e2e_permissions AS ENUM ('read', 'write')")
	mustExecSQL(t, a, connID, fmt.Sprintf(`CREATE TABLE %s (
		id integer NOT NULL,
		email character varying NOT NULL,
		scopes e2e_user_scopes[] NOT NULL,
		display_name character varying,
		disabled boolean DEFAULT false NOT NULL,
		created_at timestamp without time zone,
		username text,
		updated_at timestamp without time zone,
		modified_by integer NOT NULL,
		permissions e2e_permissions[] DEFAULT '{}'::e2e_permissions[] NOT NULL,
		CONSTRAINT %s_fk FOREIGN KEY (modified_by) REFERENCES %s(id),
		CONSTRAINT %s_pk PRIMARY KEY (id),
		CONSTRAINT %s_uq UNIQUE (username)
	)`, tbl, tbl, tbl, tbl, tbl))

	csv := "id,email,scopes,display_name,disabled,created_at,username,updated_at,modified_by,permissions\n" +
		"8,k.e@example.com,{compliance},Kyle E,true,,kyle.e,2024-04-08T12:07:05.812Z,235,{}\n" +
		"235,admin@example.com,\"{audit,billing}\",Admin,false,2023-01-02T03:04:05Z,admin,2024-01-01T00:00:00Z,235,{read}\n"
	path := filepath.Join(t.TempDir(), "users.csv")
	if err := os.WriteFile(path, []byte(csv), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	cols := strings.Split("id,email,scopes,display_name,disabled,created_at,username,updated_at,modified_by,permissions", ",")
	if result := importCSVInto(t, a, connID, e.browseSchema, tbl, cols, path); result.Skipped > 0 {
		t.Fatalf("rejected %d rows: %s", result.Skipped, first(result.Errors))
	}

	back, err := a.ExecuteQuery(connID, fmt.Sprintf(`SELECT
		disabled, created_at IS NULL, scopes[1], cardinality(permissions),
		updated_at = '2024-04-08T12:07:05.812Z'::timestamp
		FROM %s WHERE id = 8`, tbl))
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got := fmt.Sprint(back.Rows[0]); got != "[true true compliance 0 true]" {
		t.Errorf("row 8 = %s, want [true true compliance 0 true]", got)
	}
	back, err = a.ExecuteQuery(connID, fmt.Sprintf(
		"SELECT disabled, scopes[2], permissions[1] FROM %s WHERE id = 235", tbl))
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got := fmt.Sprint(back.Rows[0]); got != "[false billing read]" {
		t.Errorf("row 235 = %s, want [false billing read]", got)
	}
}
