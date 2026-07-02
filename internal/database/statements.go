package database

import (
	"regexp"
	"strings"
)

// SplitStatements splits a SQL script into individual executable statements, ignoring semicolons
// inside line/block comments, single/double/backtick-quoted text, and dollar-quoted bodies (so a
// PL/pgSQL function body or a string literal containing ';' stays in one piece). Comment-only and
// empty chunks are dropped, and the separating semicolon is excluded, so each returned string is
// ready to run on its own.
//
// This mirrors the frontend parseSqlStatements scanner (features/editor/lib/sqlStatements.ts); keep
// the two in sync so the gutter run-glyphs and backend batch execution agree on statement boundaries.
func SplitStatements(sql string) []string {
	var out []string
	n := len(sql)
	stmtStart := 0
	i := 0

	push := func(endExclusive int) {
		chunk := sql[stmtStart:endExclusive]
		if hasCode(chunk) {
			out = append(out, strings.TrimSpace(chunk))
		}
	}

	for i < n {
		c := sql[i]
		switch {
		case c == '-' && i+1 < n && sql[i+1] == '-':
			i = splitLineComment(sql, i, n)
		case c == '/' && i+1 < n && sql[i+1] == '*':
			i = splitBlockComment(sql, i, n)
		case c == '\'':
			i = splitQuoted(sql, i, '\'', true, n)
		case c == '"':
			i = splitQuoted(sql, i, '"', true, n)
		case c == '`':
			i = splitQuoted(sql, i, '`', false, n)
		case c == '$':
			i = splitDollarQuoted(sql, i, n)
		case c == ';':
			push(i) // [stmtStart, i) excludes the ';'
			i++
			stmtStart = i
		default:
			i++
		}
	}
	push(n)
	return out
}

// hasCode reports whether s holds anything other than whitespace and comments.
func hasCode(s string) bool {
	return strings.TrimSpace(StripLeadingComments(s)) != ""
}

func splitLineComment(s string, i, n int) int {
	i += 2
	for i < n && s[i] != '\n' {
		i++
	}
	return i
}

func splitBlockComment(s string, i, n int) int {
	i += 2
	for i < n-1 && !(s[i] == '*' && s[i+1] == '/') {
		i++
	}
	if i+2 < n {
		return i + 2
	}
	return n
}

// doubleEscape: ” / "" are embedded quotes (SQL convention); backticks don't double-escape.
func splitQuoted(s string, i int, quote byte, doubleEscape bool, n int) int {
	i++
	for i < n {
		if s[i] == quote {
			if doubleEscape && i+1 < n && s[i+1] == quote {
				i += 2
				continue
			}
			return i + 1
		}
		i++
	}
	return i
}

// Tags never start with a digit, so `$1$` is a placeholder between two `$`, not a quote delimiter.
var splitDollarTagRe = regexp.MustCompile(`^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$`)

func splitDollarQuoted(s string, i, n int) int {
	tag := splitDollarTagRe.FindString(s[i:])
	if tag == "" {
		return i + 1
	}
	j := i + len(tag)
	idx := strings.Index(s[j:], tag)
	if idx < 0 {
		return n
	}
	return j + idx + len(tag)
}
