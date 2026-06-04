package database

import "testing"

// Regression suite for IsReadOnlySQL: literal semicolons, comment-hidden keywords, dialect extras (PRAGMA/SHOW/DESCRIBE).
func TestIsReadOnlySQLEdgeCases(t *testing.T) {
	tests := []struct {
		name string
		sql  string
		want bool
	}{
		{"semicolon in string", `SELECT ';DELETE FROM t;' FROM dual`, true},
		{"line comment hides DELETE", "SELECT 1 -- DELETE FROM t", true},
		{"block comment hides INSERT", "SELECT 1 /* INSERT INTO t VALUES (1) */", true},
		{"DESCRIBE allowed", "DESCRIBE users", true},
		{"DESC short form", "DESC users", true},
		{"SHOW allowed", "SHOW TABLES", true},
		{"multiple selects", "SELECT 1; SELECT 2; SELECT 3", true},

		{"insert masquerading via case", "Insert Into t Values(1)", false},
		{"truncate", "TRUNCATE TABLE t", false},
		{"WITH then update", "WITH c AS (SELECT 1) UPDATE t SET x=1", false},
		{"CTE that updates inside parentheses", "WITH c AS (SELECT 1) MERGE INTO t USING c", false},
		{"first keyword EXEC", "EXEC sp_who", false},
		{"COPY", "COPY t TO 'x.csv'", false},
		{"trailing semicolon only", ";", true},
		{"only comments", "-- nothing here\n/* still nothing */", true},
		// PRAGMA without `=` is read-only; assignment form is a write.
		{"PRAGMA read form", "PRAGMA table_info(users)", true},
		{"PRAGMA assignment rejected", "PRAGMA journal_mode = WAL", false},
		{"PRAGMA writable_schema rejected", "PRAGMA writable_schema = 1", false},

		// SELECT … INTO with a column list is a write (PG create-table / MySQL OUTFILE) - must be blocked.
		{"select star into blocked", "SELECT * INTO t2 FROM t1", false},
		{"select columns into blocked", "SELECT a, b INTO t2 FROM t1", false},
		{"select into outfile blocked", "SELECT * FROM t INTO OUTFILE '/tmp/x'", false},
		// REPLACE() is a string function on a read; only REPLACE INTO is a write.
		{"replace function allowed", "SELECT REPLACE(name, 'a', 'b') FROM t", true},
		{"replace into blocked", "REPLACE INTO t (a) VALUES (1)", false},
		{"explain replace into blocked", "EXPLAIN REPLACE INTO t (a) VALUES (1)", false},
		// FOR UPDATE / FOR NO KEY UPDATE are locking reads, not writes.
		{"for update is a read", "SELECT * FROM t WHERE id = 1 FOR UPDATE", true},
		{"for no key update is a read", "SELECT * FROM t FOR NO KEY UPDATE", true},
		{"for update skip locked is a read", "SELECT * FROM t FOR UPDATE SKIP LOCKED", true},
		// …but EXPLAIN ANALYZE of a real write still executes, so stay blocked.
		{"explain analyze update blocked", "EXPLAIN ANALYZE UPDATE t SET x = 1", false},

		// RETURNING routes through QueryContext but must not relax the readonly gate.
		{"update with returning", "UPDATE t SET x = 1 RETURNING *", false},
		{"delete with returning", "DELETE FROM t WHERE id = 1 RETURNING id, name", false},
		{"insert with returning", "INSERT INTO t (a) VALUES (1) RETURNING *", false},
		{"cte that deletes returning", "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", false},
		{"cte that updates returning", "WITH u AS (UPDATE t SET x=1 RETURNING *) SELECT * FROM u", false},

		// Postgres/SQLite: `\'` does NOT close a string; old parser treated `\` as escape and could be bypassed.
		{"backslash bypass single", `SELECT 'a\'; DELETE FROM t; --'`, false},
		{"backslash bypass double quote", `SELECT "a\"; DELETE FROM t; --"`, false},

		// Old pipeline (mask-then-strip) opened phantom string on `don't`; strip-first fixes this.
		{"apostrophe in block comment", "SELECT 1 /* don't worry */ FROM t", true},
		{"apostrophe in line comment", "SELECT 1 -- don't worry\nFROM t", true},
		{"write hidden behind apostrophe-comment", "INSERT INTO t /* don't */ VALUES (1)", false},

		// firstKeyword used to see `(SELECT`/`BEGIN` and reject these.
		{"parenthesized union", "(SELECT 1) UNION (SELECT 2)", true},
		{"begin / commit allowed", "BEGIN; SELECT 1; COMMIT;", true},
		{"start transaction allowed", "START TRANSACTION; SELECT 1; ROLLBACK;", true},
		{"savepoint allowed", "SAVEPOINT s1; SELECT 1; RELEASE s1;", true},
		{"begin then write rejected", "BEGIN; DELETE FROM t; COMMIT;", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsReadOnlySQL(tc.sql); got != tc.want {
				t.Errorf("IsReadOnlySQL(%q) = %v, want %v", tc.sql, got, tc.want)
			}
		})
	}
}

func TestValidateTableFilter(t *testing.T) {
	tests := []struct {
		name    string
		filter  string
		wantErr bool
	}{
		{"empty", "", false},
		{"plain expr", "id > 5", false},
		{"string literal with semicolon", `name = 'O;Brien'`, false},
		{"string literal with comment marker", `name = '-- safe'`, false},
		{"doubled quote", `name = 'O''Brien'`, false},

		{"statement injection", "1=1; DELETE FROM users", true},
		{"injected line comment", "1=1 -- AND active = false", true},
		{"injected block comment", "1=1 /* AND active = false */", true},
		{"write keyword via union", "1=1 UNION SELECT 1 UPDATE t SET x=1", true},
		{"backslash bypass attempt", `name = 'a\'; DELETE FROM users; --'`, true},
		{"replace function in filter allowed", `name = REPLACE(other, 'a', 'b')`, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateTableFilter(tc.filter)
			if (err != nil) != tc.wantErr {
				t.Errorf("ValidateTableFilter(%q) err=%v, wantErr=%v", tc.filter, err, tc.wantErr)
			}
		})
	}
}

func TestAssertReadOnlySQL(t *testing.T) {
	if err := AssertReadOnlySQL("SELECT 1"); err != nil {
		t.Fatalf("SELECT should pass, got %v", err)
	}
	if err := AssertReadOnlySQL("DROP TABLE t"); err == nil {
		t.Fatal("DROP should be rejected")
	}
}

func TestSplitSQLStatementsHandlesQuotes(t *testing.T) {
	got := splitSQLStatements(`SELECT ';' FROM t; SELECT "a;b"`)
	if len(got) != 2 {
		t.Fatalf("expected 2 statements, got %d: %#v", len(got), got)
	}
}

func TestStripSQLCommentsKeepsStrings(t *testing.T) {
	in := `SELECT '-- not a comment', 1 -- real comment` + "\nFROM t"
	out := stripSQLComments(in)
	if !contains(out, `'-- not a comment'`) {
		t.Fatalf("string contents should survive, got %q", out)
	}
	if contains(out, "real comment") {
		t.Fatalf("line comment should be stripped, got %q", out)
	}
}

func contains(haystack, needle string) bool {
	return len(needle) == 0 || indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
