package database

import (
	"regexp"
	"strings"
)

// lexOptions are the dialect knobs; the zero value is the conservative common subset.
type lexOptions struct {
	hashLineComments    bool // MySQL `# ...`
	backslashEscapes    bool // MySQL strings: 'it\'s', "a\"b"
	doubleQuoteStrings  bool // MySQL default mode: "..." is a string literal, not an identifier
	nestedBlockComments bool // Postgres: /* outer /* inner */ still outer */
	dollarQuotes        bool // Postgres $tag$...$tag$; in MySQL `$` is just an identifier char
	clientDelimiters    bool // mysql-client `DELIMITER xx` lines switch the statement terminator
}

func lexOptionsFor(driver DriverType) lexOptions {
	return lexOptions{
		hashLineComments:    driver == DriverMySQL,
		backslashEscapes:    driver == DriverMySQL,
		doubleQuoteStrings:  driver == DriverMySQL,
		nestedBlockComments: driver == DriverPostgres,
		dollarQuotes:        driver != DriverMySQL,
		clientDelimiters:    driver == DriverMySQL,
	}
}

// mysql-client `DELIMITER xx` line: switches the terminator so procedure bodies can contain `;`.
var delimiterLineRe = regexp.MustCompile(`(?i)^DELIMITER[ \t]+(\S+)[ \t]*(?:\r?\n|$)`)

// SplitStatements splits a script into runnable statements using the driver's lexical rules
// (MySQL: # comments, backslash escapes, DELIMITER lines; Postgres: nested comments, E'…').
// Terminators and comment-only chunks are dropped. Mirrors the frontend parseSqlStatements
// scanner (features/editor/lib/sqlStatements.ts); keep the two in sync.
func SplitStatements(driver DriverType, sql string) []string {
	opts := lexOptionsFor(driver)
	var out []string
	n := len(sql)
	stmtStart := 0
	delimiter := ";"
	i := 0

	push := func(endExclusive int) {
		chunk := sql[stmtStart:endExclusive]
		if hasCode(chunk, opts) {
			out = append(out, strings.TrimSpace(chunk))
		}
	}

	for i < n {
		c := sql[i]

		if opts.clientDelimiters && (c == 'd' || c == 'D') && atLineStart(sql, i) {
			if m := delimiterLineRe.FindStringSubmatch(sql[i:]); m != nil {
				push(i) // anything pending stays its own (unterminated) statement
				delimiter = m[1]
				i += len(m[0])
				stmtStart = i
				continue
			}
		}

		switch {
		case c == '-' && i+1 < n && sql[i+1] == '-':
			i = lineCommentEnd(sql, i+2, n)
		case c == '#' && opts.hashLineComments:
			i = lineCommentEnd(sql, i+1, n)
		case c == '/' && i+1 < n && sql[i+1] == '*':
			i = blockCommentEnd(sql, i, n, opts.nestedBlockComments)
		case c == '\'':
			i = quoteEnd(sql, i, '\'', opts.backslashEscapes || isEscapeStringPrefix(sql, i), n)
		case c == '"':
			i = quoteEnd(sql, i, '"', opts.backslashEscapes && opts.doubleQuoteStrings, n)
		case c == '`':
			i = quoteEnd(sql, i, '`', false, n)
		case c == '$' && opts.dollarQuotes:
			i = splitDollarQuoted(sql, i, n)
		case c == delimiter[0] && strings.HasPrefix(sql[i:], delimiter):
			push(i) // [stmtStart, i) excludes the terminator
			i += len(delimiter)
			stmtStart = i
		default:
			i++
		}
	}
	push(n)
	return out
}

// hasCode reports whether s holds anything other than whitespace and comments.
func hasCode(s string, opts lexOptions) bool {
	i, n := 0, len(s)
	for i < n {
		switch c := s[i]; {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			i++
		case c == '-' && i+1 < n && s[i+1] == '-':
			i = lineCommentEnd(s, i+2, n)
		case c == '#' && opts.hashLineComments:
			i = lineCommentEnd(s, i+1, n)
		case c == '/' && i+1 < n && s[i+1] == '*':
			i = blockCommentEnd(s, i, n, opts.nestedBlockComments)
		default:
			return true
		}
	}
	return false
}

// atLineStart: only whitespace precedes s[i] on its line (mysql honours DELIMITER at line start only).
func atLineStart(s string, i int) bool {
	j := strings.LastIndexByte(s[:i], '\n') + 1
	return strings.TrimSpace(s[j:i]) == ""
}

// lineCommentEnd returns the index of the terminating '\n' (left unconsumed), or n at EOF.
func lineCommentEnd(s string, from, n int) int {
	if idx := strings.IndexByte(s[from:], '\n'); idx >= 0 {
		return from + idx
	}
	return n
}

// blockCommentEnd: index past the closing `*/` (nesting-aware), or n when unterminated.
func blockCommentEnd(s string, i, n int, nested bool) int {
	i += 2
	depth := 1
	for i < n {
		if s[i] == '*' && i+1 < n && s[i+1] == '/' {
			i += 2
			if depth--; depth == 0 {
				return i
			}
		} else if nested && s[i] == '/' && i+1 < n && s[i+1] == '*' {
			depth++
			i += 2
		} else {
			i++
		}
	}
	return n
}

// quoteEnd: index past the closing quote ('' doubling; optional \x escapes), or n when unterminated.
func quoteEnd(s string, i int, quote byte, backslashEscapes bool, n int) int {
	i++
	for i < n {
		switch {
		case backslashEscapes && s[i] == '\\':
			i += 2
		case s[i] == quote:
			if i+1 < n && s[i+1] == quote {
				i += 2
				continue
			}
			return i + 1
		default:
			i++
		}
	}
	return i
}

// Standalone E before the quote = Postgres escape string; `1e'…'` / `TABLE'…'` don't qualify.
func isEscapeStringPrefix(s string, quoteIdx int) bool {
	if quoteIdx < 1 {
		return false
	}
	prev := s[quoteIdx-1]
	if prev != 'e' && prev != 'E' {
		return false
	}
	if quoteIdx < 2 {
		return true
	}
	switch b := s[quoteIdx-2]; {
	case b == '_' || b == '$' || b == '\'' || b == '"' || b == '`':
		return false
	case b >= '0' && b <= '9', b >= 'a' && b <= 'z', b >= 'A' && b <= 'Z':
		return false
	}
	return true
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
