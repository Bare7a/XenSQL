package database

import (
	"testing"
	"time"
)

func TestQuoteIdent(t *testing.T) {
	tests := []struct {
		driver DriverType
		in     string
		want   string
	}{
		{DriverPostgres, "users", `"users"`},
		{DriverPostgres, `a"b`, `"a""b"`},
		{DriverMySQL, "users", "`users`"},
		{DriverMySQL, "a`b", "`a``b`"},
		{DriverSQLite, "users", `"users"`},
	}
	for _, tc := range tests {
		if got := QuoteIdent(tc.driver, tc.in); got != tc.want {
			t.Errorf("QuoteIdent(%s, %q) = %q, want %q", tc.driver, tc.in, got, tc.want)
		}
	}
}

func TestBuildQualifiedTable(t *testing.T) {
	if got := BuildQualifiedTable(DriverPostgres, "public", "users"); got != `"public"."users"` {
		t.Errorf("got %q", got)
	}
	if got := BuildQualifiedTable(DriverPostgres, "", "users"); got != `"users"` {
		t.Errorf("empty schema should drop prefix, got %q", got)
	}
	if got := BuildQualifiedTable(DriverMySQL, "shop", "orders"); got != "`shop`.`orders`" {
		t.Errorf("got %q", got)
	}
}

func TestBuildUpdateSQLValidates(t *testing.T) {
	pks := []string{"id"}
	if _, _, err := BuildUpdateSQL(DriverPostgres, "public", "t", map[string]any{}, map[string]any{"id": 1}, pks); err == nil {
		t.Error("empty changes should error")
	}
	if _, _, err := BuildUpdateSQL(DriverPostgres, "public", "t", map[string]any{"name": "x"}, map[string]any{}, pks); err == nil {
		t.Error("missing pk value should error (else WHERE degrades to pk = NULL)")
	}
	q, args, err := BuildUpdateSQL(DriverPostgres, "public", "t", map[string]any{"name": "x"}, map[string]any{"id": 1}, pks)
	if err != nil || q == "" || len(args) != 2 {
		t.Errorf("valid update: err=%v q=%q args=%v", err, q, args)
	}
}

func TestBuildDeleteSQLValidates(t *testing.T) {
	if _, _, err := BuildDeleteSQL(DriverPostgres, "public", "t", []string{"id"}, map[string]any{}); err == nil {
		t.Error("missing pk value should error")
	}
	if _, _, err := BuildDeleteSQL(DriverPostgres, "public", "t", []string{}, map[string]any{"id": 1}); err == nil {
		t.Error("no primary key should error")
	}
	if _, _, err := BuildDeleteSQL(DriverPostgres, "public", "t", []string{"id"}, map[string]any{"id": 1}); err != nil {
		t.Errorf("valid delete: %v", err)
	}
}

func TestBuildInsertSQLValidates(t *testing.T) {
	if _, _, err := BuildInsertSQL(DriverPostgres, "public", "t", map[string]any{}); err == nil {
		t.Error("empty values should error")
	}
	if _, _, err := BuildInsertSQL(DriverPostgres, "public", "t", map[string]any{"name": "x"}); err != nil {
		t.Errorf("valid insert: %v", err)
	}
}

func TestColumnExists(t *testing.T) {
	cols := []ColumnInfo{{Name: "id"}, {Name: "email"}}
	if !ColumnExists(cols, "email") {
		t.Error("email should be found")
	}
	if ColumnExists(cols, "nope") {
		t.Error("nope should not be found")
	}
}

func TestPlaceholder(t *testing.T) {
	tests := []struct {
		driver DriverType
		index  int
		want   string
	}{
		{DriverPostgres, 1, "$1"},
		{DriverPostgres, 42, "$42"},
		{DriverMySQL, 1, "?"},
		{DriverMySQL, 5, "?"},
		{DriverSQLite, 3, "?"},
	}
	for _, tc := range tests {
		if got := Placeholder(tc.driver, tc.index); got != tc.want {
			t.Errorf("Placeholder(%s, %d) = %q, want %q", tc.driver, tc.index, got, tc.want)
		}
	}
}

func TestNormalizeValue(t *testing.T) {
	if v := normalizeValue(nil); v != nil {
		t.Errorf("nil should stay nil, got %v", v)
	}
	if v := normalizeValue([]byte("hello")); v != "hello" {
		t.Errorf("[]byte should become string, got %v (%T)", v, v)
	}
	when := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	got, ok := normalizeValue(when).(string)
	if !ok {
		t.Fatalf("time.Time should be string, got %T", normalizeValue(when))
	}
	if got != when.Format(time.RFC3339Nano) {
		t.Errorf("time format wrong: %q", got)
	}
	if v := normalizeValue(int64(7)); v != int64(7) {
		t.Errorf("int passthrough failed, got %v", v)
	}
	if v := normalizeValue([]byte{0xff, 0xfe}); v != `\xfffe` {
		t.Errorf("invalid-UTF8 bytes should hex-encode, got %v", v)
	}
	if v := normalizeValue(int64(9007199254740993)); v != "9007199254740993" {
		t.Errorf("out-of-range int64 should stringify, got %v (%T)", v, v)
	}
	if v := normalizeValue(int64(-9007199254740993)); v != "-9007199254740993" {
		t.Errorf("out-of-range negative int64 should stringify, got %v", v)
	}
	if v := normalizeValue(uint64(18446744073709551615)); v != "18446744073709551615" {
		t.Errorf("large uint64 should stringify, got %v", v)
	}
	if v := normalizeValue(uint64(5)); v != uint64(5) {
		t.Errorf("small uint64 passthrough failed, got %v (%T)", v, v)
	}
}

func TestStripLeadingComments(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"SELECT 1", "SELECT 1"},
		{"  SELECT 1", "SELECT 1"},
		{"-- comment\nSELECT 1", "SELECT 1"},
		{"-- line1\n-- line2\nSELECT 1", "SELECT 1"},
		{"/* block */SELECT 1", "SELECT 1"},
		{"/* block */ SELECT 1", "SELECT 1"},
		{"-- line\n/* block */\nSELECT 1", "SELECT 1"},
		{" \t\n -- c\n /* b */ \n SELECT 1", "SELECT 1"},
		{"INSERT INTO t VALUES (1)", "INSERT INTO t VALUES (1)"},
		{"", ""},
		{"-- only comment", ""},
		{"/* unterminated", ""},
	}
	for _, tc := range tests {
		if got := StripLeadingComments(tc.in); got != tc.want {
			t.Errorf("StripLeadingComments(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestPrimaryKeys(t *testing.T) {
	cols := []ColumnInfo{
		{Name: "id", IsPrimary: true},
		{Name: "name", IsPrimary: false},
		{Name: "role_id", IsPrimary: true},
	}
	got := PrimaryKeys(cols)
	if len(got) != 2 || got[0] != "id" || got[1] != "role_id" {
		t.Errorf("PrimaryKeys got %v", got)
	}
	if pks := PrimaryKeys([]ColumnInfo{{Name: "x"}}); len(pks) != 0 {
		t.Errorf("expected empty for no PKs, got %v", pks)
	}
	if pks := PrimaryKeys(nil); len(pks) != 0 {
		t.Errorf("expected empty for nil, got %v", pks)
	}
}

func TestNowMsApproxNow(t *testing.T) {
	before := time.Now().UnixMilli()
	got := NowMs()
	after := time.Now().UnixMilli()
	if got < before || got > after {
		t.Errorf("NowMs() = %d not in [%d, %d]", got, before, after)
	}
}

func TestBuildSQLIsDeterministic(t *testing.T) {
	values := map[string]any{"b": 2, "a": 1, "c": 3}
	q, _, err := BuildInsertSQL(DriverPostgres, "public", "t", values)
	if err != nil {
		t.Fatal(err)
	}
	want := `INSERT INTO "public"."t" ("a", "b", "c") VALUES ($1, $2, $3)`
	if q != want {
		t.Errorf("BuildInsertSQL not deterministic:\n got  %s\n want %s", q, want)
	}
	uq, args, err := BuildUpdateSQL(DriverPostgres, "public", "t", values, map[string]any{"id": 9}, []string{"id"})
	if err != nil {
		t.Fatal(err)
	}
	uwant := `UPDATE "public"."t" SET "a" = $1, "b" = $2, "c" = $3 WHERE "id" = $4`
	if uq != uwant {
		t.Errorf("BuildUpdateSQL not deterministic:\n got  %s\n want %s", uq, uwant)
	}
	if len(args) != 4 || args[0] != 1 || args[1] != 2 || args[2] != 3 || args[3] != 9 {
		t.Errorf("args misordered: %#v", args)
	}
}
