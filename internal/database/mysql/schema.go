package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"xensql/internal/database"
)

func (s *Session) ListIndexes(ctx context.Context, schema, table string) ([]database.IndexInfo, error) {
	schema = s.SchemaOr(schema)
	rows, err := s.DB.QueryContext(ctx, `
		SELECT INDEX_NAME, NON_UNIQUE, INDEX_TYPE, COLUMN_NAME
		FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY INDEX_NAME, SEQ_IN_INDEX`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var order []string
	grouped := map[string]*database.IndexInfo{}
	for rows.Next() {
		var name, indexType string
		var nonUnique int
		var column sql.NullString
		if err := rows.Scan(&name, &nonUnique, &indexType, &column); err != nil {
			return nil, err
		}
		idx, seen := grouped[name]
		if !seen {
			idx = &database.IndexInfo{
				Name:      name,
				Schema:    schema,
				Table:     table,
				IsPrimary: name == "PRIMARY",
				IsUnique:  nonUnique == 0,
				Method:    strings.ToLower(indexType),
			}
			grouped[name] = idx
			order = append(order, name)
		}
		if column.Valid {
			idx.Columns = append(idx.Columns, column.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]database.IndexInfo, 0, len(order))
	for _, name := range order {
		out = append(out, *grouped[name])
	}
	return out, nil
}

func (s *Session) ListConstraints(ctx context.Context, schema, table string) ([]database.ConstraintInfo, error) {
	schema = s.SchemaOr(schema)
	rows, err := s.DB.QueryContext(ctx, `
		SELECT tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE,
			kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
		FROM information_schema.TABLE_CONSTRAINTS tc
		LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
			ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
			AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
			AND kcu.TABLE_NAME = tc.TABLE_NAME
		WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
		ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var order []string
	grouped := map[string]*database.ConstraintInfo{}
	for rows.Next() {
		var name, ctype string
		var column, refTable, refColumn sql.NullString
		if err := rows.Scan(&name, &ctype, &column, &refTable, &refColumn); err != nil {
			return nil, err
		}
		c, seen := grouped[name]
		if !seen {
			c = &database.ConstraintInfo{
				Name:     name,
				Schema:   schema,
				Table:    table,
				Type:     strings.ToUpper(ctype),
				RefTable: refTable.String,
			}
			grouped[name] = c
			order = append(order, name)
		}
		if column.Valid {
			c.Columns = append(c.Columns, column.String)
		}
		if refColumn.Valid {
			c.RefColumns = append(c.RefColumns, refColumn.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	clauses := s.checkClauses(ctx, schema)
	out := make([]database.ConstraintInfo, 0, len(order))
	for _, name := range order {
		c := *grouped[name]
		if c.Type == "CHECK" {
			if clause, ok := clauses[name]; ok {
				c.Definition = "CHECK " + clause
			}
		}
		out = append(out, c)
	}
	return out, nil
}

// The table only exists on MySQL 8.0.16+ / MariaDB 10.2.22+, so a failure degrades to no clauses.
func (s *Session) checkClauses(ctx context.Context, schema string) map[string]string {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT CONSTRAINT_NAME, CHECK_CLAUSE
		FROM information_schema.CHECK_CONSTRAINTS
		WHERE CONSTRAINT_SCHEMA = ?`, schema)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var name, clause string
		if err := rows.Scan(&name, &clause); err != nil {
			return out
		}
		out[name] = clause
	}
	return out
}

func (s *Session) ListTriggers(ctx context.Context, schema, table string) ([]database.TriggerInfo, error) {
	schema = s.SchemaOr(schema)
	rows, err := s.DB.QueryContext(ctx, `
		SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION
		FROM information_schema.TRIGGERS
		WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?
		ORDER BY TRIGGER_NAME`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []database.TriggerInfo
	for rows.Next() {
		var name, timing, event string
		if err := rows.Scan(&name, &timing, &event); err != nil {
			return nil, err
		}
		out = append(out, database.TriggerInfo{
			Name: name, Schema: schema, Table: table,
			Timing: strings.ToUpper(timing), Events: strings.ToUpper(event),
		})
	}
	return out, rows.Err()
}

// ListRoutines leaves Args empty: MySQL forbids overloading.
func (s *Session) ListRoutines(ctx context.Context, schema string) ([]database.RoutineInfo, error) {
	schema = s.SchemaOr(schema)
	rows, err := s.DB.QueryContext(ctx, `
		SELECT ROUTINE_NAME, ROUTINE_TYPE, COALESCE(DTD_IDENTIFIER, '')
		FROM information_schema.ROUTINES
		WHERE ROUTINE_SCHEMA = ?
		ORDER BY ROUTINE_TYPE, ROUTINE_NAME`, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []database.RoutineInfo
	for rows.Next() {
		var name, routineType, returnType string
		if err := rows.Scan(&name, &routineType, &returnType); err != nil {
			return nil, err
		}
		kind := database.ObjectFunction
		if strings.EqualFold(routineType, "PROCEDURE") {
			kind = database.ObjectProcedure
			returnType = ""
		}
		out = append(out, database.RoutineInfo{
			Name: name, Schema: schema, Kind: kind, ReturnType: returnType,
		})
	}
	return out, rows.Err()
}

func (s *Session) ObjectDDL(ctx context.Context, ref database.ObjectRef) (string, error) {
	schema := s.SchemaOr(ref.Schema)
	qualified := database.BuildQualifiedTable(database.DriverMySQL, schema, ref.Name)
	switch ref.Kind {
	case database.ObjectTable:
		return s.showCreate(ctx, "SHOW CREATE TABLE "+qualified, "Create Table")
	case database.ObjectView:
		return s.showCreate(ctx, "SHOW CREATE VIEW "+qualified, "Create View")
	case database.ObjectTrigger:
		// Not a "Create *" column, and the row also carries a "Created" timestamp.
		return s.showCreate(ctx, "SHOW CREATE TRIGGER "+qualified, "SQL Original Statement")
	case database.ObjectFunction:
		return s.showCreate(ctx, "SHOW CREATE FUNCTION "+qualified, "Create Function")
	case database.ObjectProcedure:
		return s.showCreate(ctx, "SHOW CREATE PROCEDURE "+qualified, "Create Procedure")
	case database.ObjectIndex:
		return s.indexDDL(ctx, schema, ref)
	case database.ObjectConstraint:
		return s.constraintDDL(ctx, schema, ref)
	}
	return "", database.ErrUnsupportedDDL(database.DriverMySQL, ref.Kind)
}

// The fallback skips "Created", which is a timestamp, not DDL.
func columnIndex(cols []string, defColumn string) int {
	for i, c := range cols {
		if strings.EqualFold(c, defColumn) {
			return i
		}
	}
	for i, c := range cols {
		lc := strings.ToLower(c)
		if strings.HasPrefix(lc, "create") && lc != "created" {
			return i
		}
	}
	return -1
}

// indexDDL synthesizes CREATE INDEX; MySQL has no SHOW CREATE INDEX.
func (s *Session) indexDDL(ctx context.Context, schema string, ref database.ObjectRef) (string, error) {
	indexes, err := s.ListIndexes(ctx, schema, ref.Table)
	if err != nil {
		return "", err
	}
	for _, idx := range indexes {
		if idx.Name != ref.Name {
			continue
		}
		if idx.IsPrimary {
			return fmt.Sprintf("ALTER TABLE %s ADD PRIMARY KEY (%s);",
				database.BuildQualifiedTable(database.DriverMySQL, schema, ref.Table),
				database.QuoteIdentList(database.DriverMySQL, idx.Columns)), nil
		}
		if synth := database.RenderCreateIndex(database.DriverMySQL, idx); synth != "" {
			return synth, nil
		}
	}
	return "", fmt.Errorf("index %s not found on %s", ref.Name, ref.Table)
}

func (s *Session) constraintDDL(ctx context.Context, schema string, ref database.ObjectRef) (string, error) {
	constraints, err := s.ListConstraints(ctx, schema, ref.Table)
	if err != nil {
		return "", err
	}
	for _, c := range constraints {
		if c.Name != ref.Name {
			continue
		}
		clause := database.RenderConstraint(database.DriverMySQL, c)
		if clause == "" {
			break
		}
		return fmt.Sprintf("ALTER TABLE %s\n    ADD %s;",
			database.BuildQualifiedTable(database.DriverMySQL, schema, ref.Table), clause), nil
	}
	return "", fmt.Errorf("constraint %s not found on %s", ref.Name, ref.Table)
}

func (s *Session) showCreate(ctx context.Context, stmt, defColumn string) (string, error) {
	rows, err := s.DB.QueryContext(ctx, stmt)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return "", err
	}
	target := columnIndex(cols, defColumn)
	if target < 0 {
		return "", fmt.Errorf("no %q column in %s", defColumn, stmt)
	}
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return "", err
		}
		return "", fmt.Errorf("no definition returned by %s", stmt)
	}
	values := make([]sql.NullString, len(cols))
	dest := make([]any, len(cols))
	for i := range values {
		dest[i] = &values[i]
	}
	if err := rows.Scan(dest...); err != nil {
		return "", err
	}
	return database.TerminateStatement(values[target].String), nil
}
