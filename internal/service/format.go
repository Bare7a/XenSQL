package service

import (
	"regexp"
	"strings"
)

// Opening tag of a Postgres dollar-quoted string; tags follow identifier rules (no leading digit).
var dollarQuoteTagRe = regexp.MustCompile(`^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$`)

// Longer multi-word keywords listed first so "LEFT JOIN" wins over "JOIN" in the regex alternation.
var keywordBreakers = []string{
	"LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "OUTER JOIN", "CROSS JOIN",
	"GROUP BY", "ORDER BY", "INSERT INTO", "DELETE FROM",
	"CREATE TABLE", "ALTER TABLE", "DROP TABLE", "UNION ALL",
	"SELECT", "FROM", "WHERE", "JOIN", "HAVING", "LIMIT", "OFFSET",
	"VALUES", "UPDATE", "SET", "UNION", "ON", "AND", "OR",
}

var keywordBreakRe = regexp.MustCompile(
	`(?i)\b(` + strings.Join(keywordBreakers, "|") + `)\b`,
)

// Basic fallback formatter; frontend uses sql-formatter for richer output.
func FormatSQL(sql string) string {
	sql = strings.TrimSpace(sql)
	if sql == "" {
		return sql
	}
	broken := breakKeywordsOutsideLiterals(sql)
	lines := strings.Split(broken, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, line)
		}
	}
	return strings.Join(out, "\n")
}

// Applies the keyword line-break/upcase to code only - string literals are copied verbatim so a value
// like 'shipped and ready' isn't rewritten.
func breakKeywordsOutsideLiterals(sql string) string {
	var b strings.Builder
	b.Grow(len(sql) + 16)
	runStart := 0
	flushCode := func(end int) {
		if runStart >= end {
			return
		}
		b.WriteString(keywordBreakRe.ReplaceAllStringFunc(sql[runStart:end], func(m string) string {
			return "\n" + strings.ToUpper(m)
		}))
	}
	for i := 0; i < len(sql); {
		ch := sql[i]
		if ch == '\'' || ch == '"' || ch == '`' {
			flushCode(i)
			i = copyLiteralVerbatim(sql, i, ch, &b)
			runStart = i
			continue
		}
		if ch == '$' {
			if tag := dollarQuoteTagRe.FindString(sql[i:]); tag != "" {
				flushCode(i)
				i = copyDollarVerbatim(sql, i, tag, &b)
				runStart = i
				continue
			}
		}
		i++
	}
	flushCode(len(sql))
	return b.String()
}

func copyLiteralVerbatim(sql string, i int, quote byte, b *strings.Builder) int {
	start := i
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
		i++ // closing quote
		b.WriteString(sql[start:i])
		return i
	}
	b.WriteString(sql[start:i]) // unterminated
	return i
}

func copyDollarVerbatim(sql string, i int, tag string, b *strings.Builder) int {
	start := i
	body := i + len(tag)
	end := len(sql)
	if close := strings.Index(sql[body:], tag); close >= 0 {
		end = body + close + len(tag)
	}
	b.WriteString(sql[start:end])
	return end
}
