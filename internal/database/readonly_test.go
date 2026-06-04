package database

import "testing"

func TestIsReadOnlySQL(t *testing.T) {
	tests := []struct {
		sql  string
		want bool
	}{
		{"SELECT 1", true},
		{"SELECT * FROM users WHERE note = 'DELETE me'", true},
		{"WITH c AS (SELECT 1) SELECT * FROM c", true},
		{"EXPLAIN SELECT 1", true},
		{"PRAGMA table_info(users)", true},
		{"", true},
		{"INSERT INTO t VALUES (1)", false},
		{"UPDATE t SET x = 1", false},
		{"DELETE FROM t", false},
		{"DROP TABLE t", false},
		{"SELECT 1; DELETE FROM t", false},
		{"WITH c AS (SELECT 1) DELETE FROM t", false},
		{"SELECT INTO new_t FROM old_t", false},
		{"CREATE TABLE t (id int)", false},
	}
	for _, tc := range tests {
		got := IsReadOnlySQL(tc.sql)
		if got != tc.want {
			t.Errorf("IsReadOnlySQL(%q) = %v, want %v", tc.sql, got, tc.want)
		}
	}
}

// A quote inside a dollar-quoted string or backtick identifier must not hide a trailing write.
func TestIsReadOnlySQLQuotingBypass(t *testing.T) {
	tests := []struct {
		sql  string
		want bool
	}{
		// Bypass attempts that must stay BLOCKED.
		{`WITH x AS (SELECT $$ ' $$) DELETE FROM t`, false},
		{`SELECT $$it's$$; DELETE FROM users`, false},
		{"SELECT * FROM `weird'name` ; DROP TABLE t", false},
		{"WITH x AS (SELECT 1 AS `a'b`) DELETE FROM t", false},
		{`WITH x AS (SELECT $tag$ ' $tag$) UPDATE t SET a = 1`, false},
		// Legitimate reads using the same quoting must stay ALLOWED.
		{`SELECT $$ hello ; world $$`, true},
		{`SELECT $tag$ a ' b $tag$ AS c`, true},
		{"SELECT `select`, `from` FROM t", true},
		{`SELECT * FROM t WHERE note = $$DROP TABLE x$$`, true},
		{`SELECT * FROM t WHERE id = $1`, true}, // $1 is a bind placeholder, not a dollar-quote
	}
	for _, tc := range tests {
		if got := IsReadOnlySQL(tc.sql); got != tc.want {
			t.Errorf("IsReadOnlySQL(%q) = %v, want %v", tc.sql, got, tc.want)
		}
	}
}

// Bare reads and known inspection pragmas are allowed; any other argument-bearing PRAGMA is a write.
func TestIsReadOnlySQLPragma(t *testing.T) {
	tests := []struct {
		sql  string
		want bool
	}{
		{`PRAGMA foreign_keys`, true},
		{`PRAGMA table_info(users)`, true},
		{`PRAGMA index_list('t')`, true},
		{`PRAGMA foreign_key_check`, true},
		{`PRAGMA foreign_keys = on`, false},
		{`PRAGMA foreign_keys(0)`, false},
		{`PRAGMA journal_mode(WAL)`, false},
		{`PRAGMA incremental_vacuum(10)`, false},
	}
	for _, tc := range tests {
		if got := IsReadOnlySQL(tc.sql); got != tc.want {
			t.Errorf("IsReadOnlySQL(%q) = %v, want %v", tc.sql, got, tc.want)
		}
	}
}
