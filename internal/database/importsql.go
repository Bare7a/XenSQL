package database

import (
	"fmt"
	"strings"
)

type ImportColumnType string

const (
	ImportBool      ImportColumnType = "bool"
	ImportInt       ImportColumnType = "int"
	ImportFloat     ImportColumnType = "float"
	ImportDate      ImportColumnType = "date"
	ImportTimestamp ImportColumnType = "timestamp"
	ImportText      ImportColumnType = "text"
)

var sqlTypeNames = map[ImportColumnType]struct{ postgres, mysql, sqlite string }{
	ImportBool:      {"boolean", "TINYINT(1)", "INTEGER"},
	ImportInt:       {"bigint", "BIGINT", "INTEGER"},
	ImportFloat:     {"double precision", "DOUBLE", "REAL"},
	ImportDate:      {"date", "DATE", "TEXT"},
	ImportTimestamp: {"timestamp", "DATETIME", "TEXT"},
	ImportText:      {"text", "TEXT", "TEXT"},
}

// Matched as substrings, so VARCHAR(50), LONGTEXT, NVARCHAR etc. all hit.
var emptyStringTypes = []string{"CHAR", "TEXT", "CLOB", "STRING", "ENUM", "SET", "BINARY", "BLOB", "BYTEA"}

// AcceptsEmptyString reports whether this type can hold ”; unknown or blank types are assumed to.
func AcceptsEmptyString(dataType string) bool {
	upper := strings.ToUpper(strings.TrimSpace(dataType))
	if upper == "" {
		return true
	}
	for _, t := range emptyStringTypes {
		if strings.Contains(upper, t) {
			return true
		}
	}
	return !knownNonTextType(upper)
}

// Types that reject ” outright.
var nonTextTypes = []string{
	"INT", "SERIAL", "DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "REAL", "MONEY", "BIT",
	"BOOL", "DATE", "TIME", "YEAR", "JSON", "UUID", "INTERVAL", "XML", "OID", "ARRAY",
}

func knownNonTextType(upper string) bool {
	for _, t := range nonTextTypes {
		if strings.Contains(upper, t) {
			return true
		}
	}
	return false
}

func SQLTypeFor(driver DriverType, t ImportColumnType) string {
	names, ok := sqlTypeNames[t]
	if !ok {
		names = sqlTypeNames[ImportText]
	}
	switch driver {
	case DriverMySQL:
		return names.mysql
	case DriverSQLite:
		return names.sqlite
	default:
		return names.postgres
	}
}

// Every column is nullable; a partly-blank source column would otherwise fail the whole load.
func BuildImportCreateTable(driver DriverType, schema, table string, columns []string, types []ImportColumnType) (string, error) {
	if len(columns) == 0 {
		return "", fmt.Errorf("no columns to create")
	}
	if len(types) != len(columns) {
		return "", fmt.Errorf("got %d columns but %d types", len(columns), len(types))
	}
	cols := make([]DDLColumn, len(columns))
	for i, name := range columns {
		cols[i] = DDLColumn{Name: name, Type: SQLTypeFor(driver, types[i])}
	}
	return ComposeCreateTable(driver, schema, table, cols, nil), nil
}

func BuildBatchInsert(driver DriverType, schema, table string, columns []string, rows [][]any) (string, []any, error) {
	if len(columns) == 0 {
		return "", nil, fmt.Errorf("no target columns")
	}
	if len(rows) == 0 {
		return "", nil, fmt.Errorf("no rows to insert")
	}
	var b strings.Builder
	b.WriteString("INSERT INTO ")
	b.WriteString(BuildQualifiedTable(driver, schema, table))
	b.WriteString(" (")
	b.WriteString(QuoteIdentList(driver, columns))
	b.WriteString(") VALUES ")

	args := make([]any, 0, len(rows)*len(columns))
	for r, row := range rows {
		if len(row) != len(columns) {
			return "", nil, fmt.Errorf("row %d has %d values, want %d", r, len(row), len(columns))
		}
		if r > 0 {
			b.WriteString(", ")
		}
		b.WriteByte('(')
		for c, v := range row {
			if c > 0 {
				b.WriteString(", ")
			}
			b.WriteString(Placeholder(driver, len(args)+1))
			args = append(args, v)
		}
		b.WriteByte(')')
	}
	return b.String(), args, nil
}

// BuildTruncate uses DELETE: SQLite has no TRUNCATE and elsewhere it needs extra privileges.
func BuildTruncate(driver DriverType, schema, table string) string {
	return "DELETE FROM " + BuildQualifiedTable(driver, schema, table)
}
