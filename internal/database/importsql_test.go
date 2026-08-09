package database

import (
	"strings"
	"testing"
)

func TestSQLTypeFor(t *testing.T) {
	tests := []struct {
		driver DriverType
		in     ImportColumnType
		want   string
	}{
		{DriverPostgres, ImportInt, "bigint"},
		{DriverPostgres, ImportBool, "boolean"},
		{DriverPostgres, ImportTimestamp, "timestamp"},
		{DriverMySQL, ImportInt, "BIGINT"},
		{DriverMySQL, ImportBool, "TINYINT(1)"},
		{DriverMySQL, ImportTimestamp, "DATETIME"},
		{DriverSQLite, ImportInt, "INTEGER"},
		{DriverSQLite, ImportFloat, "REAL"},
		{DriverSQLite, ImportDate, "TEXT"},
		{DriverPostgres, ImportColumnType("nonsense"), "text"},
	}
	for _, tc := range tests {
		if got := SQLTypeFor(tc.driver, tc.in); got != tc.want {
			t.Errorf("SQLTypeFor(%s, %s) = %q, want %q", tc.driver, tc.in, got, tc.want)
		}
	}
}

func TestBuildImportCreateTable(t *testing.T) {
	got, err := BuildImportCreateTable(DriverPostgres, "public", "people",
		[]string{"id", "name", "joined"},
		[]ImportColumnType{ImportInt, ImportText, ImportDate})
	if err != nil {
		t.Fatalf("BuildImportCreateTable: %v", err)
	}
	want := `CREATE TABLE "public"."people" (
    "id" bigint,
    "name" text,
    "joined" date
);`
	if got != want {
		t.Errorf("BuildImportCreateTable()\n got %s\nwant %s", got, want)
	}
	if strings.Contains(got, "NOT NULL") {
		t.Errorf("import tables should be all-nullable, got %s", got)
	}
}

func TestBuildImportCreateTableRejectsMismatch(t *testing.T) {
	if _, err := BuildImportCreateTable(DriverPostgres, "public", "t", []string{"a", "b"},
		[]ImportColumnType{ImportInt}); err == nil {
		t.Error("expected an error when types and columns differ in length")
	}
	if _, err := BuildImportCreateTable(DriverPostgres, "public", "t", nil, nil); err == nil {
		t.Error("expected an error for a table with no columns")
	}
}

func TestBuildBatchInsert(t *testing.T) {
	t.Run("postgres numbers its placeholders across rows", func(t *testing.T) {
		stmt, args, err := BuildBatchInsert(DriverPostgres, "public", "people",
			[]string{"id", "name"},
			[][]any{{1, "Alice"}, {2, nil}})
		if err != nil {
			t.Fatalf("BuildBatchInsert: %v", err)
		}
		want := `INSERT INTO "public"."people" ("id", "name") VALUES ($1, $2), ($3, $4)`
		if stmt != want {
			t.Errorf("stmt = %s, want %s", stmt, want)
		}
		if len(args) != 4 || args[0] != 1 || args[1] != "Alice" || args[3] != nil {
			t.Errorf("args = %v", args)
		}
	})

	t.Run("mysql uses positional placeholders", func(t *testing.T) {
		stmt, args, err := BuildBatchInsert(DriverMySQL, "shop", "orders",
			[]string{"id"}, [][]any{{1}, {2}})
		if err != nil {
			t.Fatalf("BuildBatchInsert: %v", err)
		}
		if stmt != "INSERT INTO `shop`.`orders` (`id`) VALUES (?), (?)" {
			t.Errorf("stmt = %s", stmt)
		}
		if len(args) != 2 {
			t.Errorf("args = %v", args)
		}
	})

	t.Run("values never reach the statement text", func(t *testing.T) {
		stmt, args, err := BuildBatchInsert(DriverPostgres, "public", "t",
			[]string{"c"}, [][]any{{"'); DROP TABLE t; --"}})
		if err != nil {
			t.Fatalf("BuildBatchInsert: %v", err)
		}
		if strings.Contains(stmt, "DROP TABLE") {
			t.Errorf("value was interpolated into SQL: %s", stmt)
		}
		if args[0] != "'); DROP TABLE t; --" {
			t.Errorf("value should ride as a parameter, got %v", args[0])
		}
	})

	t.Run("rejects a row whose width does not match the columns", func(t *testing.T) {
		if _, _, err := BuildBatchInsert(DriverPostgres, "public", "t",
			[]string{"a", "b"}, [][]any{{1, 2}, {3}}); err == nil {
			t.Error("expected an error for a short row")
		}
	})

	t.Run("rejects empty input", func(t *testing.T) {
		if _, _, err := BuildBatchInsert(DriverPostgres, "public", "t", nil, [][]any{{1}}); err == nil {
			t.Error("expected an error with no columns")
		}
		if _, _, err := BuildBatchInsert(DriverPostgres, "public", "t", []string{"a"}, nil); err == nil {
			t.Error("expected an error with no rows")
		}
	})
}

func TestBuildTruncate(t *testing.T) {
	if got := BuildTruncate(DriverPostgres, "public", "t"); got != `DELETE FROM "public"."t"` {
		t.Errorf("BuildTruncate() = %q", got)
	}
	if got := BuildTruncate(DriverMySQL, "shop", "t"); got != "DELETE FROM `shop`.`t`" {
		t.Errorf("BuildTruncate() = %q", got)
	}
}

func TestAcceptsEmptyString(t *testing.T) {
	cases := map[string]bool{
		"TEXT":              true,
		"text":              true,
		"VARCHAR(50)":       true,
		"character varying": true,
		"LONGTEXT":          true,
		"NVARCHAR(10)":      true,
		"CHAR(1)":           true,
		"ENUM('a','b')":     true,
		"BYTEA":             true,
		"BLOB":              true,
		"":                  true, // SQLite's flexible typing
		"widget_status":     true, // unknown domain type: assume text-shaped
		"INT":               false,
		"INTEGER":           false,
		"BIGINT":            false,
		"SERIAL":            false,
		"DECIMAL(10,2)":     false,
		"numeric":           false,
		"DOUBLE PRECISION":  false,
		"REAL":              false,
		"BOOLEAN":           false,
		"DATE":              false,
		"DATETIME":          false,
		"TIMESTAMP":         false,
		"TIME":              false,
		"JSONB":             false,
		"UUID":              false,
	}
	for dataType, want := range cases {
		if got := AcceptsEmptyString(dataType); got != want {
			t.Errorf("AcceptsEmptyString(%q) = %v, want %v", dataType, got, want)
		}
	}
}
