package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"

	"xensql/internal/database"
)

// SQLite has no routines.
func (s *Session) ListRoutines(ctx context.Context, schema string) ([]database.RoutineInfo, error) {
	return nil, nil
}

func (s *Session) ListIndexes(ctx context.Context, schema, table string) ([]database.IndexInfo, error) {
	entries, err := s.indexList(ctx, table)
	if err != nil {
		return nil, err
	}
	indexes := make([]database.IndexInfo, 0, len(entries))
	for _, e := range entries {
		cols, err := s.indexColumns(ctx, e.name)
		if err != nil {
			return nil, err
		}
		indexes = append(indexes, database.IndexInfo{
			Name:      e.name,
			Schema:    "main",
			Table:     table,
			Columns:   cols,
			IsPrimary: e.origin == "pk",
			IsUnique:  e.unique,
		})
	}
	return indexes, nil
}

type sqliteIndexEntry struct {
	name   string
	unique bool
	// origin is "c" (CREATE INDEX), "u" (UNIQUE constraint) or "pk" (PRIMARY KEY).
	origin string
}

func (s *Session) indexList(ctx context.Context, table string) ([]sqliteIndexEntry, error) {
	rows, err := s.DB.QueryContext(ctx,
		fmt.Sprintf("PRAGMA index_list(%s)", database.QuoteIdent(database.DriverSQLite, table)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []sqliteIndexEntry
	for rows.Next() {
		var seq int
		var name, origin string
		var unique, partial int
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			return nil, err
		}
		out = append(out, sqliteIndexEntry{name: name, unique: unique == 1, origin: origin})
	}
	return out, rows.Err()
}

func (s *Session) indexColumns(ctx context.Context, index string) ([]string, error) {
	rows, err := s.DB.QueryContext(ctx,
		fmt.Sprintf("PRAGMA index_info(%s)", database.QuoteIdent(database.DriverSQLite, index)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var seqno, cid int
		var name sql.NullString
		if err := rows.Scan(&seqno, &cid, &name); err != nil {
			return nil, err
		}
		if name.Valid {
			cols = append(cols, name.String)
		}
	}
	return cols, rows.Err()
}

// CHECK has no pragma, so it appears only in the table's own DDL.
func (s *Session) ListConstraints(ctx context.Context, schema, table string) ([]database.ConstraintInfo, error) {
	cols, err := s.ListColumns(ctx, schema, table)
	if err != nil {
		return nil, err
	}
	out := make([]database.ConstraintInfo, 0, 4)
	if pks := database.PrimaryKeys(cols); len(pks) > 0 {
		out = append(out, database.ConstraintInfo{
			Schema: "main", Table: table, Type: "PRIMARY KEY", Columns: pks,
		})
	}

	uniques, err := s.indexList(ctx, table)
	if err != nil {
		return nil, err
	}
	for _, e := range uniques {
		if e.origin != "u" {
			continue
		}
		ucols, err := s.indexColumns(ctx, e.name)
		if err != nil {
			return nil, err
		}
		out = append(out, database.ConstraintInfo{
			Name: e.name, Schema: "main", Table: table, Type: "UNIQUE", Columns: ucols,
		})
	}

	fks, err := s.foreignKeyConstraints(ctx, table)
	if err != nil {
		return nil, err
	}
	return append(out, fks...), nil
}

func (s *Session) foreignKeyConstraints(ctx context.Context, table string) ([]database.ConstraintInfo, error) {
	rows, err := s.DB.QueryContext(ctx,
		fmt.Sprintf("PRAGMA foreign_key_list(%s)", database.QuoteIdent(database.DriverSQLite, table)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var order []int
	grouped := map[int]*database.ConstraintInfo{}
	for rows.Next() {
		var id, seq int
		var refTable, from string
		var to sql.NullString
		var onUpdate, onDelete, matchType string
		if err := rows.Scan(&id, &seq, &refTable, &from, &to, &onUpdate, &onDelete, &matchType); err != nil {
			return nil, err
		}
		c, seen := grouped[id]
		if !seen {
			c = &database.ConstraintInfo{
				Schema: "main", Table: table, Type: "FOREIGN KEY", RefTable: refTable,
			}
			grouped[id] = c
			order = append(order, id)
		}
		c.Columns = append(c.Columns, from)
		if to.Valid {
			c.RefColumns = append(c.RefColumns, to.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]database.ConstraintInfo, 0, len(order))
	for _, id := range order {
		out = append(out, *grouped[id])
	}
	return out, nil
}

func (s *Session) ListTriggers(ctx context.Context, schema, table string) ([]database.TriggerInfo, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT name, COALESCE(sql, '') FROM sqlite_master
		WHERE type = 'trigger' AND tbl_name = ?
		ORDER BY name`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []database.TriggerInfo
	for rows.Next() {
		var name, ddl string
		if err := rows.Scan(&name, &ddl); err != nil {
			return nil, err
		}
		timing, events := parseTriggerHead(ddl)
		out = append(out, database.TriggerInfo{
			Name: name, Schema: "main", Table: table, Timing: timing, Events: events,
		})
	}
	return out, rows.Err()
}

var sqliteTriggerHead = regexp.MustCompile(`(?is)\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(.*?)\s+ON\s`)

// parseTriggerHead reads timing and event from a stored CREATE TRIGGER; SQLite defaults to BEFORE.
func parseTriggerHead(ddl string) (timing, events string) {
	m := sqliteTriggerHead.FindStringSubmatch(ddl)
	if m == nil {
		return "", ""
	}
	head := strings.ToUpper(strings.Join(strings.Fields(m[1]), " "))
	switch {
	case strings.Contains(head, "INSTEAD OF"):
		timing = "INSTEAD OF"
	case strings.Contains(head, "AFTER"):
		timing = "AFTER"
	default:
		timing = "BEFORE"
	}
	for _, ev := range []string{"INSERT", "UPDATE", "DELETE"} {
		if strings.Contains(head, ev) {
			events = ev
			break
		}
	}
	return timing, events
}

func (s *Session) ObjectDDL(ctx context.Context, ref database.ObjectRef) (string, error) {
	switch ref.Kind {
	case database.ObjectTable, database.ObjectView:
		return s.relationDDL(ctx, ref)
	case database.ObjectTrigger:
		return s.masterDDL(ctx, "trigger", ref.Name)
	case database.ObjectIndex:
		return s.indexDDL(ctx, ref)
	case database.ObjectConstraint:
		return s.relationDDL(ctx, database.ObjectRef{Kind: database.ObjectTable, Name: ref.Table})
	}
	return "", database.ErrUnsupportedDDL(database.DriverSQLite, ref.Kind)
}

// SQLite stores standalone indexes as separate statements.
func (s *Session) relationDDL(ctx context.Context, ref database.ObjectRef) (string, error) {
	base, err := s.masterDDL(ctx, string(ref.Kind), ref.Name)
	if err != nil {
		return "", err
	}
	if ref.Kind != database.ObjectTable {
		return base, nil
	}
	rows, err := s.DB.QueryContext(ctx, `
		SELECT sql FROM sqlite_master
		WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
		ORDER BY name`, ref.Name)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	blocks := []string{base}
	for rows.Next() {
		var ddl string
		if err := rows.Scan(&ddl); err != nil {
			return "", err
		}
		blocks = append(blocks, database.TerminateStatement(ddl))
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return database.JoinDDL(blocks...), nil
}

// Implicit indexes are stored with a NULL sql, so they are synthesized.
func (s *Session) indexDDL(ctx context.Context, ref database.ObjectRef) (string, error) {
	ddl, err := s.masterDDL(ctx, "index", ref.Name)
	if err == nil && ddl != "" {
		return ddl, nil
	}
	indexes, listErr := s.ListIndexes(ctx, ref.Schema, ref.Table)
	if listErr != nil {
		return "", listErr
	}
	for _, idx := range indexes {
		if idx.Name != ref.Name {
			continue
		}
		if synth := database.RenderCreateIndex(database.DriverSQLite, idx); synth != "" {
			return synth, nil
		}
		return "", fmt.Errorf("index %s is created implicitly by its constraint", ref.Name)
	}
	return "", err
}

// Empty, not an error, when sql is NULL.
func (s *Session) masterDDL(ctx context.Context, objType, name string) (string, error) {
	var ddl sql.NullString
	err := s.DB.QueryRowContext(ctx,
		`SELECT sql FROM sqlite_master WHERE type = ? AND name = ?`, objType, name).Scan(&ddl)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("%s %s not found", objType, name)
	}
	if err != nil {
		return "", err
	}
	return database.TerminateStatement(ddl.String), nil
}
