package service

import (
	"strings"
	"testing"
)

func TestFormatSQLEmpty(t *testing.T) {
	if got := FormatSQL(""); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
	if got := FormatSQL("   "); got != "" {
		t.Fatalf("expected empty for whitespace, got %q", got)
	}
}

func TestFormatSQLBreaksOnKeywords(t *testing.T) {
	// FormatSQL uppercases keywords and breaks lines; richer formatting is handled by the frontend's sql-formatter.
	got := FormatSQL("select id from users where active = 1 order by id")
	lines := strings.Split(got, "\n")
	if len(lines) < 4 {
		t.Fatalf("expected multi-line, got %q", got)
	}
	if lines[0] != "SELECT id" {
		t.Fatalf("first line should be 'SELECT id', got %q", lines[0])
	}
	if !contains(lines, "FROM users") {
		t.Fatalf("missing FROM line: %q", got)
	}
	if !contains(lines, "WHERE active = 1") {
		t.Fatalf("missing WHERE line: %q", got)
	}
	if !contains(lines, "ORDER BY id") {
		t.Fatalf("missing ORDER BY line: %q", got)
	}
}

func TestFormatSQLPreservesIdentifierCase(t *testing.T) {
	got := FormatSQL("SELECT UserId, FullName FROM AppUsers WHERE FullName = 'Alice'")
	if !strings.Contains(got, "UserId") || !strings.Contains(got, "FullName") || !strings.Contains(got, "AppUsers") {
		t.Fatalf("expected identifier casing preserved, got %q", got)
	}
	if !strings.Contains(got, "'Alice'") {
		t.Fatalf("expected string literal preserved verbatim, got %q", got)
	}
}

func TestFormatSQLNoLeadingBlankLine(t *testing.T) {
	got := FormatSQL("SELECT 1")
	if strings.HasPrefix(got, "\n") {
		t.Fatalf("output should not start with newline: %q", got)
	}
}

func TestFormatSQLDoesNotRewriteStringLiterals(t *testing.T) {
	// A keyword-like word inside a literal must not be upcased or line-broken.
	got := FormatSQL("SELECT * FROM t WHERE note = 'shipped and ready or not'")
	if !strings.Contains(got, "'shipped and ready or not'") {
		t.Fatalf("string literal must be preserved verbatim, got %q", got)
	}
	// Postgres dollar-quoted body is also off-limits.
	got = FormatSQL("SELECT $$a or b and c$$ FROM t")
	if !strings.Contains(got, "$$a or b and c$$") {
		t.Fatalf("dollar-quoted body must be preserved verbatim, got %q", got)
	}
	// A backtick identifier that looks like a keyword stays intact; only the real FROM breaks.
	got = FormatSQL("SELECT `from` FROM t")
	if !strings.Contains(got, "`from`") {
		t.Fatalf("backtick identifier must be preserved verbatim, got %q", got)
	}
}

func contains(slice []string, want string) bool {
	for _, s := range slice {
		if s == want {
			return true
		}
	}
	return false
}
