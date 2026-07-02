package service

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"xensql/internal/database"
)

func ExportResult(result *database.QueryResult, format string) (string, error) {
	switch strings.ToLower(format) {
	case "json":
		return exportJSON(result)
	case "csv":
		return exportCSV(result)
	case "sql":
		return exportSQL(result), nil
	case "markdown":
		return exportMarkdown(result), nil
	case "text":
		return exportText(result), nil
	default:
		return "", fmt.Errorf("unsupported export format: %s", format)
	}
}

// encoding/json sorts map keys alphabetically; this preserves column order to match JSON.stringify.
type orderedObject struct {
	columns []string
	values  []any
}

func (o orderedObject) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, col := range o.columns {
		if i > 0 {
			b.WriteByte(',')
		}
		key, err := marshalJSONValue(col)
		if err != nil {
			return nil, err
		}
		b.Write(key)
		b.WriteByte(':')
		val, err := marshalJSONValue(o.values[i])
		if err != nil {
			return nil, err
		}
		b.Write(val)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// Encodes without HTML escaping to match JSON.stringify behaviour (<, >, & left as-is).
func marshalJSONValue(v any) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(b.Bytes(), "\n"), nil
}

func exportJSON(result *database.QueryResult) (string, error) {
	objs := make([]orderedObject, 0, len(result.Rows))
	for _, row := range result.Rows {
		objs = append(objs, orderedObject{columns: result.Columns, values: row})
	}
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(objs); err != nil {
		return "", err
	}
	return strings.TrimRight(b.String(), "\n"), nil
}

func exportCSV(result *database.QueryResult) (string, error) {
	var b strings.Builder
	w := csv.NewWriter(&b)
	if err := w.Write(result.Columns); err != nil {
		return "", err
	}
	for _, row := range result.Rows {
		record := make([]string, len(row))
		for i, v := range row {
			record[i] = sanitizeCSVCell(cellString(v))
		}
		if err := w.Write(record); err != nil {
			return "", err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return "", err
	}
	// csv.Writer always appends a trailing newline; drop it to match the TS exporter.
	return strings.TrimSuffix(b.String(), "\n"), nil
}

func exportSQL(result *database.QueryResult) string {
	table := result.TableName
	if table == "" {
		table = "results"
	}
	cols := make([]string, len(result.Columns))
	for i, c := range result.Columns {
		cols[i] = quoteIdent(c)
	}
	colList := strings.Join(cols, ", ")
	tableIdent := quoteIdent(table)
	lines := make([]string, 0, len(result.Rows))
	for _, row := range result.Rows {
		vals := make([]string, len(row))
		for i, v := range row {
			vals[i] = sqlLiteral(v)
		}
		lines = append(lines, fmt.Sprintf(`INSERT INTO %s (%s) VALUES (%s);`,
			tableIdent, colList, strings.Join(vals, ", ")))
	}
	return strings.Join(lines, "\n")
}

func exportMarkdown(result *database.QueryResult) string {
	lines := make([]string, 0, len(result.Rows)+2)
	// Escape headers too (mirrors markdownCell), so a column named `a|b` can't break the alignment.
	header := make([]string, len(result.Columns))
	for i, c := range result.Columns {
		header[i] = markdownCell(c)
	}
	lines = append(lines, "| "+strings.Join(header, " | ")+" |")
	seps := make([]string, len(result.Columns))
	for i := range seps {
		seps[i] = "---"
	}
	lines = append(lines, "| "+strings.Join(seps, " | ")+" |")
	for _, row := range result.Rows {
		cells := make([]string, len(row))
		for i, v := range row {
			cells[i] = markdownCell(v)
		}
		lines = append(lines, "| "+strings.Join(cells, " | ")+" |")
	}
	return strings.Join(lines, "\n")
}

func exportText(result *database.QueryResult) string {
	lines := make([]string, 0, len(result.Rows))
	for _, row := range result.Rows {
		cells := make([]string, len(row))
		for i, v := range row {
			cells[i] = cellString(v)
		}
		lines = append(lines, strings.Join(cells, "\t"))
	}
	return strings.Join(lines, "\n")
}

func cellString(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

// quoteIdent double-quotes a SQL identifier, escaping any embedded quote.
func quoteIdent(id string) string {
	return `"` + strings.ReplaceAll(id, `"`, `""`) + `"`
}

// sanitizeCSVCell defuses spreadsheet formula injection (cells starting = + - @), leaving plain numbers (-5) alone.
func sanitizeCSVCell(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@':
		if _, err := strconv.ParseFloat(s, 64); err != nil {
			return "'" + s
		}
	}
	return s
}

// Collapses any newline flavour to a space so a value can't break a Markdown table row.
var newlineToSpace = strings.NewReplacer("\r\n", " ", "\r", " ", "\n", " ")

// Escapes pipes and flattens newlines so the value doesn't break the Markdown table structure.
func markdownCell(v any) string {
	if v == nil {
		return ""
	}
	s := strings.ReplaceAll(fmt.Sprint(v), "|", "\\|")
	return newlineToSpace.Replace(s)
}

func sqlLiteral(v any) string {
	if v == nil {
		return "NULL"
	}
	switch val := v.(type) {
	case string:
		return "'" + strings.ReplaceAll(val, "'", "''") + "'"
	case bool:
		if val {
			return "TRUE"
		}
		return "FALSE"
	case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return fmt.Sprint(val)
	default:
		return "'" + strings.ReplaceAll(fmt.Sprint(val), "'", "''") + "'"
	}
}
