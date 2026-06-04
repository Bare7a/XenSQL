package database

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

var ErrReadOnly = errors.New("connection is read-only: only read queries (SELECT, EXPLAIN, etc.) are allowed")

var (
	withWriteAfterCTE = regexp.MustCompile(`(?is)\)\s*(insert|update|delete|merge|replace)\b`)
	forbiddenInStmt   = []*regexp.Regexp{
		// SELECT … INTO is a write (PG create-table / MySQL OUTFILE); columns sit between the keywords.
		regexp.MustCompile(`(?is)\bselect\b.*\binto\b`),
		regexp.MustCompile(`(?is)\bcopy\s+`),
		// Match only REPLACE INTO; bare `replace` would flag the REPLACE() function.
		regexp.MustCompile(`(?is)\breplace\s+into\b`),
		regexp.MustCompile(`(?is)\b(insert|update|delete|drop|create|alter|truncate|merge|grant|revoke|vacuum|reindex|attach|detach)\b`),
	}
	// FOR UPDATE / FOR NO KEY UPDATE are locking reads; blank them so the bare `update` rule doesn't flag them.
	lockingClauseRe = regexp.MustCompile(`(?i)\bfor\s+(no\s+key\s+)?update\b`)
	// An argument-bearing PRAGMA (`x = y` or `x(y)`), capturing the name; the bare read form is allowed.
	pragmaArgRe = regexp.MustCompile(`(?is)^\s*pragma\s+(?:\w+\.)?(\w+)\s*(?:=|\()`)
	// Postgres dollar-quote opening tag; tags never start with a digit, so `$1` stays a placeholder.
	dollarQuoteTagRe = regexp.MustCompile(`^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$`)
)

// Argument-bearing PRAGMAs that only inspect; any other PRAGMA with an argument is treated as a write.
var pragmaReadOnly = map[string]bool{
	"table_info": true, "table_xinfo": true, "table_list": true,
	"index_info": true, "index_xinfo": true, "index_list": true,
	"foreign_key_list": true, "foreign_key_check": true,
	"database_list": true, "collation_list": true, "function_list": true,
	"module_list": true, "pragma_list": true, "compile_options": true,
	"integrity_check": true, "quick_check": true,
}

var allowedFirstKeywords = map[string]bool{
	"SELECT":   true,
	"WITH":     true,
	"EXPLAIN":  true,
	"PRAGMA":   true,
	"SHOW":     true,
	"DESCRIBE": true,
	"DESC":     true,
	"TABLE":    true, // e.g. SQLite/PG `TABLE name` shorthand for `SELECT * FROM name`
	// Transaction-control keywords; inner statements are checked individually.
	"BEGIN":     true,
	"COMMIT":    true,
	"END":       true,
	"ROLLBACK":  true,
	"START":     true,
	"SAVEPOINT": true,
	"RELEASE":   true,
}

var deniedFirstKeywords = map[string]bool{
	"INSERT": true, "UPDATE": true, "DELETE": true, "DROP": true, "CREATE": true,
	"ALTER": true, "TRUNCATE": true, "MERGE": true, "REPLACE": true, "GRANT": true,
	"REVOKE": true, "CALL": true, "EXEC": true, "EXECUTE": true, "VACUUM": true,
	"REINDEX": true, "ATTACH": true, "DETACH": true, "COMMENT": true, "COPY": true,
	"CLUSTER": true, "DISCARD": true, "DO": true, "LOCK": true, "REFRESH": true,
}

func AssertReadOnlySQL(sql string) error {
	if IsReadOnlySQL(sql) {
		return nil
	}
	return ErrReadOnly
}

// ValidateTableFilter rejects filters that escape the WHERE clause (semicolons, comment markers, write keywords).
// Runs unconditionally - a writable connection must still block `; DELETE FROM …` via the table-data path.
func ValidateTableFilter(filter string) error {
	filter = strings.TrimSpace(filter)
	if filter == "" {
		return nil
	}
	// Mask strings but not comments: a bare `--` or `/*` is an injection attempt to comment out the LIMIT.
	masked := maskStringLiterals(filter)
	if strings.Contains(masked, ";") {
		return fmt.Errorf("filter must be a single boolean expression: ';' is not allowed")
	}
	if strings.Contains(masked, "--") || strings.Contains(masked, "/*") || strings.Contains(masked, "*/") {
		return fmt.Errorf("filter must not contain comment markers")
	}
	upper := lockingClauseRe.ReplaceAllString(strings.ToUpper(masked), " ")
	for _, re := range forbiddenInStmt {
		if re.MatchString(upper) {
			return fmt.Errorf("filter must not contain write keywords")
		}
	}
	return nil
}

// Strip comments before masking strings: apostrophes inside comments would open phantom string literals.
// Backslash treated as literal - safe for Postgres (standard_conforming_strings) and SQLite;
// MySQL `\'` only ever exposes more content to the scanner, never less.
func IsReadOnlySQL(sql string) bool {
	cleaned := maskStringLiterals(stripSQLComments(sql))
	for _, stmt := range splitSQLStatements(cleaned) {
		if !isReadOnlyStatement(stmt) {
			return false
		}
	}
	return true
}

func isReadOnlyStatement(stmt string) bool {
	stmt = strings.TrimSpace(stmt)
	if stmt == "" {
		return true
	}

	first := firstKeyword(stmt)
	if first == "" {
		return true
	}
	if deniedFirstKeywords[first] {
		return false
	}
	if !allowedFirstKeywords[first] {
		return false
	}
	if first == "WITH" && withWriteAfterCTE.MatchString(stmt) {
		return false
	}
	if first == "PRAGMA" && !isReadOnlyPragma(stmt) {
		return false
	}
	upper := lockingClauseRe.ReplaceAllString(strings.ToUpper(stmt), " ")
	for _, re := range forbiddenInStmt {
		if re.MatchString(upper) {
			return false
		}
	}
	return true
}

func firstKeyword(stmt string) string {
	stmt = strings.TrimSpace(stmt)
	// Strip leading parens so `(SELECT 1) UNION (SELECT 2)` resolves to SELECT.
	for len(stmt) > 0 && stmt[0] == '(' {
		stmt = strings.TrimSpace(stmt[1:])
	}
	if stmt == "" {
		return ""
	}
	fields := strings.Fields(stmt)
	if len(fields) == 0 {
		return ""
	}
	return strings.ToUpper(fields[0])
}

// isReadOnlyPragma allows the bare `PRAGMA name` read form and known inspection pragmas; any other
// argument-bearing PRAGMA may mutate settings or the file.
func isReadOnlyPragma(stmt string) bool {
	m := pragmaArgRe.FindStringSubmatch(stmt)
	if m == nil {
		return true
	}
	return pragmaReadOnly[strings.ToLower(m[1])]
}

// dollarQuoteTag returns the dollar-quote opening tag at sql[i] (e.g. "$$"/"$tag$"), or "" if none.
func dollarQuoteTag(sql string, i int) string {
	return dollarQuoteTagRe.FindString(sql[i:])
}

// Blanks string-literal contents - single/double quotes, MySQL backticks, Postgres dollar-quotes -
// so embedded keywords, quotes, comments, or `;` can't confuse the classifier.
func maskStringLiterals(sql string) string {
	var b strings.Builder
	b.Grow(len(sql))
	for i := 0; i < len(sql); {
		ch := sql[i]
		switch {
		case ch == '\'' || ch == '"' || ch == '`':
			i = scanQuoted(sql, i, ch, true, &b)
		case ch == '$':
			if tag := dollarQuoteTag(sql, i); tag != "" {
				i = scanDollarQuoted(sql, i, tag, true, &b)
				continue
			}
			b.WriteByte(ch)
			i++
		default:
			b.WriteByte(ch)
			i++
		}
	}
	return b.String()
}

// Removes -- and /* */ comments, preserving string/dollar-quoted spans so a marker inside one isn't stripped.
func stripSQLComments(sql string) string {
	var b strings.Builder
	b.Grow(len(sql))
	for i := 0; i < len(sql); {
		ch := sql[i]
		switch {
		case ch == '-' && i+1 < len(sql) && sql[i+1] == '-':
			i += 2
			for i < len(sql) && sql[i] != '\n' {
				i++
			}
		case ch == '/' && i+1 < len(sql) && sql[i+1] == '*':
			i += 2
			for i+1 < len(sql) && !(sql[i] == '*' && sql[i+1] == '/') {
				i++
			}
			if i+1 < len(sql) {
				i += 2
			} else {
				i = len(sql)
			}
		case ch == '\'' || ch == '"' || ch == '`':
			i = scanQuoted(sql, i, ch, false, &b)
		case ch == '$':
			if tag := dollarQuoteTag(sql, i); tag != "" {
				i = scanDollarQuoted(sql, i, tag, false, &b)
				continue
			}
			b.WriteByte(ch)
			i++
		default:
			b.WriteByte(ch)
			i++
		}
	}
	return b.String()
}

func quotedSpanEnd(sql string, i int, quote byte) int {
	i++ // opening quote
	for i < len(sql) {
		if sql[i] != quote {
			i++
			continue
		}
		if i+1 < len(sql) && sql[i+1] == quote {
			i += 2 // doubled-quote escape
			continue
		}
		return i + 1 // closing quote
	}
	return i // unterminated: consume to end
}

func dollarSpanEnd(sql string, i int, tag string) int {
	body := i + len(tag)
	if close := strings.Index(sql[body:], tag); close >= 0 {
		return body + close + len(tag)
	}
	return len(sql)
}

func emitSpan(sql string, lo, hi int, mask bool, b *strings.Builder) {
	if !mask {
		b.WriteString(sql[lo:hi])
		return
	}
	for j := lo; j < hi; j++ {
		b.WriteByte(' ')
	}
}

// scanQuoted consumes the quoted span at sql[i] (doubled-quote escape), writing spaces when mask is
// true else copying verbatim, and returns the index past the closing quote.
func scanQuoted(sql string, i int, quote byte, mask bool, b *strings.Builder) int {
	end := quotedSpanEnd(sql, i, quote)
	emitSpan(sql, i, end, mask, b)
	return end
}

// scanDollarQuoted consumes the dollar-quoted span (tag at sql[i]), masking or copying like scanQuoted.
func scanDollarQuoted(sql string, i int, tag string, mask bool, b *strings.Builder) int {
	end := dollarSpanEnd(sql, i, tag)
	emitSpan(sql, i, end, mask, b)
	return end
}

// Splits at top-level `;`, ignoring semicolons inside string, backtick, or dollar-quoted spans.
func splitSQLStatements(sql string) []string {
	var out []string
	start := 0
	for i := 0; i < len(sql); {
		switch ch := sql[i]; {
		case ch == '\'' || ch == '"' || ch == '`':
			i = quotedSpanEnd(sql, i, ch)
		case ch == '$':
			if tag := dollarQuoteTag(sql, i); tag != "" {
				i = dollarSpanEnd(sql, i, tag)
				continue
			}
			i++
		case ch == ';':
			out = append(out, sql[start:i])
			start = i + 1
			i++
		default:
			i++
		}
	}
	if tail := strings.TrimSpace(sql[start:]); tail != "" {
		out = append(out, tail)
	}
	return out
}
