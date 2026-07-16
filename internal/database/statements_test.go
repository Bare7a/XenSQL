package database

import (
	"reflect"
	"testing"
)

func TestSplitStatements(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{"empty", "", nil},
		{"whitespace only", "   \n\t ", nil},
		{"comment only", "-- just a comment\n/* and a block */", nil},
		{"single, no semicolon", "SELECT 1", []string{"SELECT 1"}},
		{"single, trailing semicolon", "SELECT 1;", []string{"SELECT 1"}},
		{"two statements", "SELECT 1; SELECT 2;", []string{"SELECT 1", "SELECT 2"}},
		{"two, no trailing", "SELECT 1; SELECT 2", []string{"SELECT 1", "SELECT 2"}},
		{"blank chunks dropped", "SELECT 1;; ;SELECT 2;", []string{"SELECT 1", "SELECT 2"}},
		{"semicolon in single quotes", "SELECT ';' AS a; SELECT 2", []string{"SELECT ';' AS a", "SELECT 2"}},
		{"semicolon in double-quoted ident", `SELECT 1 AS "a;b"; SELECT 2`, []string{`SELECT 1 AS "a;b"`, "SELECT 2"}},
		{"semicolon in backtick ident", "SELECT 1 AS `a;b`; SELECT 2", []string{"SELECT 1 AS `a;b`", "SELECT 2"}},
		{"escaped quote inside string", "SELECT 'it''s; fine'; SELECT 2", []string{"SELECT 'it''s; fine'", "SELECT 2"}},
		{"semicolon in line comment", "SELECT 1 -- a; b\n; SELECT 2", []string{"SELECT 1 -- a; b", "SELECT 2"}},
		{"semicolon in block comment", "SELECT 1 /* a; b */; SELECT 2", []string{"SELECT 1 /* a; b */", "SELECT 2"}},
		{
			"dollar-quoted function body keeps inner semicolons",
			"CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql; SELECT f()",
			[]string{
				"CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql",
				"SELECT f()",
			},
		},
		{
			"tagged dollar quote",
			"SELECT $tag$ a; b $tag$; SELECT 2",
			[]string{"SELECT $tag$ a; b $tag$", "SELECT 2"},
		},
		{"trims surrounding whitespace", "  SELECT 1  ;\n\n  SELECT 2  ", []string{"SELECT 1", "SELECT 2"}},
		{"leading comment retained on statement", "-- note\nSELECT 1;", []string{"-- note\nSELECT 1"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SplitStatements("", tt.in)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("SplitStatements(%q)\n  got  %#v\n  want %#v", tt.in, got, tt.want)
			}
		})
	}
}

// Mirrors the frontend dialect tests (sqlStatements.test.ts); the two scanners must agree on
// statement boundaries.
func TestSplitStatementsDialects(t *testing.T) {
	tests := []struct {
		name   string
		driver DriverType
		in     string
		want   []string
	}{
		{
			"mysql: backslash-escaped quote does not end the string",
			DriverMySQL,
			`SELECT 'it\'s a; test'; SELECT 2`,
			[]string{`SELECT 'it\'s a; test'`, "SELECT 2"},
		},
		{
			"mysql: # starts a line comment",
			DriverMySQL,
			"SELECT 1 # ; not a split\n; SELECT 2",
			[]string{"SELECT 1 # ; not a split", "SELECT 2"},
		},
		{
			"mysql: $ is an identifier character, not a dollar quote",
			DriverMySQL,
			"SELECT a$tag$ FROM t; SELECT b$tag$ FROM u",
			[]string{"SELECT a$tag$ FROM t", "SELECT b$tag$ FROM u"},
		},
		{
			"mysql: comment-only # chunk is dropped",
			DriverMySQL,
			"# just a note\nSELECT 1;",
			[]string{"# just a note\nSELECT 1"},
		},
		{
			"postgres: block comments nest",
			DriverPostgres,
			"/* outer /* inner */ ; still comment */ SELECT 1",
			[]string{"/* outer /* inner */ ; still comment */ SELECT 1"},
		},
		{
			"postgres: E'…' honours backslash escapes",
			DriverPostgres,
			`SELECT E'a\'b; not a split'; SELECT 2`,
			[]string{`SELECT E'a\'b; not a split'`, "SELECT 2"},
		},
		{
			"sqlite: backslash is a plain character",
			DriverSQLite,
			`SELECT 'path\'; SELECT 2`,
			[]string{`SELECT 'path\'`, "SELECT 2"},
		},
		{
			"mysql: DELIMITER keeps procedure bodies whole and strips the terminator",
			DriverMySQL,
			"DELIMITER //\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND//\nDELIMITER ;\nSELECT 3;",
			[]string{"CREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND", "SELECT 3"},
		},
		{
			"mysql: DELIMITER only counts at the start of a line",
			DriverMySQL,
			"SELECT delimiter FROM t; SELECT 2",
			[]string{"SELECT delimiter FROM t", "SELECT 2"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SplitStatements(tt.driver, tt.in)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("SplitStatements(%s, %q)\n  got  %#v\n  want %#v", tt.driver, tt.in, got, tt.want)
			}
		})
	}
}
