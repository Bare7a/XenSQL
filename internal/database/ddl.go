package database

import (
	"fmt"
	"strings"
)

const ddlIndent = "    "

type DDLColumn struct {
	Name      string
	Type      string
	NotNull   bool
	Default   string
	Collation string
	// Identity is "ALWAYS" or "BY DEFAULT" on an identity column.
	Identity string
	// Generated excludes Default; a generated column cannot have one.
	Generated string
}

func RenderColumn(driver DriverType, col DDLColumn) string {
	var b strings.Builder
	b.WriteString(QuoteIdent(driver, col.Name))
	if col.Type != "" {
		b.WriteString(" " + col.Type)
	}
	if col.Collation != "" {
		b.WriteString(" COLLATE " + QuoteIdent(driver, col.Collation))
	}
	switch {
	case col.Generated != "":
		b.WriteString(" GENERATED ALWAYS AS (" + col.Generated + ") STORED")
	case col.Identity != "":
		b.WriteString(" GENERATED " + col.Identity + " AS IDENTITY")
	case col.Default != "":
		b.WriteString(" DEFAULT " + col.Default)
	}
	if col.NotNull {
		b.WriteString(" NOT NULL")
	}
	return b.String()
}

func ComposeCreateTable(driver DriverType, schema, table string, cols []DDLColumn, tableConstraints []string) string {
	lines := make([]string, 0, len(cols)+len(tableConstraints))
	for _, col := range cols {
		lines = append(lines, ddlIndent+RenderColumn(driver, col))
	}
	for _, c := range tableConstraints {
		lines = append(lines, ddlIndent+c)
	}
	head := "CREATE TABLE " + BuildQualifiedTable(driver, schema, table)
	if len(lines) == 0 {
		return head + " ();"
	}
	return head + " (\n" + strings.Join(lines, ",\n") + "\n);"
}

// RenderConstraint prefers the engine's own Definition; empty when neither form is usable.
func RenderConstraint(driver DriverType, c ConstraintInfo) string {
	body := c.Definition
	if body == "" {
		body = synthesizeConstraintBody(driver, c)
	}
	if body == "" {
		return ""
	}
	if c.Name == "" {
		return body
	}
	return "CONSTRAINT " + QuoteIdent(driver, c.Name) + " " + body
}

func synthesizeConstraintBody(driver DriverType, c ConstraintInfo) string {
	cols := QuoteIdentList(driver, c.Columns)
	switch strings.ToUpper(c.Type) {
	case "PRIMARY KEY":
		if cols == "" {
			return ""
		}
		return "PRIMARY KEY (" + cols + ")"
	case "UNIQUE":
		if cols == "" {
			return ""
		}
		return "UNIQUE (" + cols + ")"
	case "FOREIGN KEY":
		if cols == "" || c.RefTable == "" {
			return ""
		}
		ref := QuoteIdent(driver, c.RefTable)
		if len(c.RefColumns) > 0 {
			ref += " (" + QuoteIdentList(driver, c.RefColumns) + ")"
		}
		return "FOREIGN KEY (" + cols + ") REFERENCES " + ref
	}
	return ""
}

// RenderCreateIndex is empty for a primary-key index, which has no standalone form.
func RenderCreateIndex(driver DriverType, idx IndexInfo) string {
	if idx.IsPrimary || len(idx.Columns) == 0 {
		return ""
	}
	unique := ""
	if idx.IsUnique {
		unique = "UNIQUE "
	}
	using := ""
	// USING is Postgres-only syntax, though MySQL reports a method too.
	if idx.Method != "" && driver == DriverPostgres {
		using = " USING " + idx.Method
	}
	return fmt.Sprintf("CREATE %sINDEX %s ON %s%s (%s);",
		unique,
		QuoteIdent(driver, idx.Name),
		BuildQualifiedTable(driver, idx.Schema, idx.Table),
		using,
		QuoteIdentList(driver, idx.Columns))
}

func QuoteIdentList(driver DriverType, idents []string) string {
	if len(idents) == 0 {
		return ""
	}
	quoted := make([]string, len(idents))
	for i, id := range idents {
		quoted[i] = QuoteIdent(driver, id)
	}
	return strings.Join(quoted, ", ")
}

func JoinDDL(blocks ...string) string {
	kept := make([]string, 0, len(blocks))
	for _, b := range blocks {
		if trimmed := strings.TrimRight(b, " \t\n"); trimmed != "" {
			kept = append(kept, trimmed)
		}
	}
	return strings.Join(kept, "\n\n")
}

func TerminateStatement(sqlText string) string {
	trimmed := strings.TrimRight(sqlText, " \t\r\n")
	if trimmed == "" || strings.HasSuffix(trimmed, ";") {
		return trimmed
	}
	return trimmed + ";"
}

func ErrUnsupportedDDL(driver DriverType, kind ObjectKind) error {
	return fmt.Errorf("%s does not expose DDL for %s objects", driver, kind)
}
