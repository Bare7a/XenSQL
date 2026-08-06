package postgres

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
		SELECT i.relname, ix.indisunique, ix.indisprimary, am.amname, a.attname
		FROM pg_catalog.pg_index ix
		JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
		JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
		JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
		JOIN pg_catalog.pg_am am ON am.oid = i.relam
		LEFT JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
		LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
		WHERE n.nspname = $1 AND t.relname = $2
		ORDER BY i.relname, k.ord`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var order []string
	grouped := map[string]*database.IndexInfo{}
	for rows.Next() {
		var name, method string
		var unique, primary bool
		var column sql.NullString
		if err := rows.Scan(&name, &unique, &primary, &method, &column); err != nil {
			return nil, err
		}
		idx, seen := grouped[name]
		if !seen {
			idx = &database.IndexInfo{
				Name: name, Schema: schema, Table: table,
				IsPrimary: primary, IsUnique: unique, Method: method,
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

func constraintTypeName(contype string) string {
	switch contype {
	case "p":
		return "PRIMARY KEY"
	case "f":
		return "FOREIGN KEY"
	case "u":
		return "UNIQUE"
	case "c":
		return "CHECK"
	case "x":
		return "EXCLUDE"
	}
	return strings.ToUpper(contype)
}

func (s *Session) ListConstraints(ctx context.Context, schema, table string) ([]database.ConstraintInfo, error) {
	schema = s.SchemaOr(schema)
	rows, err := s.DB.QueryContext(ctx, `
		SELECT con.conname, con.contype,
			pg_catalog.pg_get_constraintdef(con.oid, true),
			COALESCE(reft.relname, ''),
			a.attname, refa.attname
		FROM pg_catalog.pg_constraint con
		JOIN pg_catalog.pg_class t ON t.oid = con.conrelid
		JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
		LEFT JOIN pg_catalog.pg_class reft ON reft.oid = con.confrelid
		LEFT JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
		LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
		LEFT JOIN pg_catalog.pg_attribute refa ON refa.attrelid = con.confrelid
			AND refa.attnum = con.confkey[k.ord]
		WHERE n.nspname = $1 AND t.relname = $2
		ORDER BY con.contype, con.conname, k.ord`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var order []string
	grouped := map[string]*database.ConstraintInfo{}
	for rows.Next() {
		var name, contype, def, refTable string
		var column, refColumn sql.NullString
		if err := rows.Scan(&name, &contype, &def, &refTable, &column, &refColumn); err != nil {
			return nil, err
		}
		c, seen := grouped[name]
		if !seen {
			c = &database.ConstraintInfo{
				Name: name, Schema: schema, Table: table,
				Type: constraintTypeName(contype), Definition: def, RefTable: refTable,
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
	out := make([]database.ConstraintInfo, 0, len(order))
	for _, name := range order {
		out = append(out, *grouped[name])
	}
	return out, nil
}

// pg_trigger.tgtype bit flags; see the TRIGGER_TYPE_* macros in the Postgres source.
const (
	trigTypeBefore   = 1 << 1
	trigTypeInsert   = 1 << 2
	trigTypeDelete   = 1 << 3
	trigTypeUpdate   = 1 << 4
	trigTypeTruncate = 1 << 5
	trigTypeInstead  = 1 << 6
)

func decodeTriggerType(tgtype int) (timing, events string) {
	switch {
	case tgtype&trigTypeInstead != 0:
		timing = "INSTEAD OF"
	case tgtype&trigTypeBefore != 0:
		timing = "BEFORE"
	default:
		timing = "AFTER"
	}
	var parts []string
	for _, e := range []struct {
		bit  int
		name string
	}{
		{trigTypeInsert, "INSERT"},
		{trigTypeUpdate, "UPDATE"},
		{trigTypeDelete, "DELETE"},
		{trigTypeTruncate, "TRUNCATE"},
	} {
		if tgtype&e.bit != 0 {
			parts = append(parts, e.name)
		}
	}
	return timing, strings.Join(parts, ", ")
}

func (s *Session) ListTriggers(ctx context.Context, schema, table string) ([]database.TriggerInfo, error) {
	schema = s.SchemaOr(schema)
	// tgisinternal hides the triggers Postgres creates to enforce foreign keys.
	rows, err := s.DB.QueryContext(ctx, `
		SELECT tg.tgname, tg.tgtype
		FROM pg_catalog.pg_trigger tg
		JOIN pg_catalog.pg_class t ON t.oid = tg.tgrelid
		JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
		WHERE n.nspname = $1 AND t.relname = $2 AND NOT tg.tgisinternal
		ORDER BY tg.tgname`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []database.TriggerInfo
	for rows.Next() {
		var name string
		var tgtype int
		if err := rows.Scan(&name, &tgtype); err != nil {
			return nil, err
		}
		timing, events := decodeTriggerType(tgtype)
		out = append(out, database.TriggerInfo{
			Name: name, Schema: schema, Table: table, Timing: timing, Events: events,
		})
	}
	return out, rows.Err()
}

func (s *Session) ListRoutines(ctx context.Context, schema string) ([]database.RoutineInfo, error) {
	schema = s.SchemaOr(schema)
	rows, err := s.DB.QueryContext(ctx, `
		SELECT p.proname,
			p.prokind,
			COALESCE(pg_catalog.pg_get_function_result(p.oid), ''),
			COALESCE(pg_catalog.pg_get_function_identity_arguments(p.oid), '')
		FROM pg_catalog.pg_proc p
		JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')
		ORDER BY p.proname, 4`, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []database.RoutineInfo
	for rows.Next() {
		var name, prokind, result, args string
		if err := rows.Scan(&name, &prokind, &result, &args); err != nil {
			return nil, err
		}
		kind := database.ObjectFunction
		if prokind == "p" {
			kind = database.ObjectProcedure
			result = ""
		}
		out = append(out, database.RoutineInfo{
			Name: name, Schema: schema, Kind: kind, ReturnType: result, Args: args,
		})
	}
	return out, rows.Err()
}

func (s *Session) ObjectDDL(ctx context.Context, ref database.ObjectRef) (string, error) {
	schema := s.SchemaOr(ref.Schema)
	switch ref.Kind {
	case database.ObjectTable:
		return s.tableDDL(ctx, schema, ref.Name)
	case database.ObjectView, database.ObjectMatView:
		return s.viewDDL(ctx, schema, ref)
	case database.ObjectIndex:
		return s.scalarDDL(ctx, `
			SELECT pg_catalog.pg_get_indexdef(i.oid)
			FROM pg_catalog.pg_class i
			JOIN pg_catalog.pg_namespace n ON n.oid = i.relnamespace
			WHERE n.nspname = $1 AND i.relname = $2 AND i.relkind IN ('i', 'I')`,
			"index", ref.Name, schema, ref.Name)
	case database.ObjectTrigger:
		return s.scalarDDL(ctx, `
			SELECT pg_catalog.pg_get_triggerdef(tg.oid, true)
			FROM pg_catalog.pg_trigger tg
			JOIN pg_catalog.pg_class t ON t.oid = tg.tgrelid
			JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
			WHERE n.nspname = $1 AND t.relname = $2 AND tg.tgname = $3`,
			"trigger", ref.Name, schema, ref.Table, ref.Name)
	case database.ObjectConstraint:
		return s.constraintDDL(ctx, schema, ref)
	case database.ObjectFunction, database.ObjectProcedure:
		return s.routineDDL(ctx, schema, ref)
	}
	return "", database.ErrUnsupportedDDL(database.DriverPostgres, ref.Kind)
}

func (s *Session) viewDDL(ctx context.Context, schema string, ref database.ObjectRef) (string, error) {
	def, err := s.scalarDDL(ctx, `
		SELECT pg_catalog.pg_get_viewdef(c.oid, true)
		FROM pg_catalog.pg_class c
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('v', 'm')`,
		"view", ref.Name, schema, ref.Name)
	if err != nil {
		return "", err
	}
	head := "CREATE OR REPLACE VIEW "
	if ref.Kind == database.ObjectMatView {
		// A materialized view has no OR REPLACE form.
		head = "CREATE MATERIALIZED VIEW "
	}
	return head + database.BuildQualifiedTable(database.DriverPostgres, schema, ref.Name) + " AS\n" + def, nil
}

func (s *Session) constraintDDL(ctx context.Context, schema string, ref database.ObjectRef) (string, error) {
	def, err := s.scalarDDL(ctx, `
		SELECT pg_catalog.pg_get_constraintdef(con.oid, true)
		FROM pg_catalog.pg_constraint con
		JOIN pg_catalog.pg_class t ON t.oid = con.conrelid
		JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
		WHERE n.nspname = $1 AND t.relname = $2 AND con.conname = $3`,
		"constraint", ref.Name, schema, ref.Table, ref.Name)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("ALTER TABLE ONLY %s\n    ADD CONSTRAINT %s %s;",
		database.BuildQualifiedTable(database.DriverPostgres, schema, ref.Table),
		database.QuoteIdent(database.DriverPostgres, ref.Name),
		strings.TrimSuffix(def, ";")), nil
}

func (s *Session) routineDDL(ctx context.Context, schema string, ref database.ObjectRef) (string, error) {
	return s.scalarDDL(ctx, `
		SELECT pg_catalog.pg_get_functiondef(p.oid)
		FROM pg_catalog.pg_proc p
		JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname = $1 AND p.proname = $2
		  AND ($3 = '' OR pg_catalog.pg_get_function_identity_arguments(p.oid) = $3)
		ORDER BY p.oid
		LIMIT 1`,
		string(ref.Kind), ref.Name, schema, ref.Name, ref.Args)
}

// tableDDL composes CREATE TABLE from the catalog; Postgres has no SHOW CREATE TABLE.
func (s *Session) tableDDL(ctx context.Context, schema, table string) (string, error) {
	cols, err := s.ddlColumns(ctx, schema, table)
	if err != nil {
		return "", err
	}
	if len(cols) == 0 {
		return "", fmt.Errorf("table %s not found", table)
	}
	constraints, err := s.ListConstraints(ctx, schema, table)
	if err != nil {
		return "", err
	}
	clauses := make([]string, 0, len(constraints))
	constrained := make(map[string]bool, len(constraints))
	for _, c := range constraints {
		constrained[c.Name] = true
		if clause := database.RenderConstraint(database.DriverPostgres, c); clause != "" {
			clauses = append(clauses, clause)
		}
	}

	blocks := []string{database.ComposeCreateTable(database.DriverPostgres, schema, table, cols, clauses)}

	indexes, err := s.ListIndexes(ctx, schema, table)
	if err != nil {
		return "", err
	}
	for _, idx := range indexes {
		// Shares the constraint name; already covered by the clause above.
		if constrained[idx.Name] {
			continue
		}
		if synth := database.RenderCreateIndex(database.DriverPostgres, idx); synth != "" {
			blocks = append(blocks, synth)
		}
	}

	comments, err := s.tableComments(ctx, schema, table)
	if err != nil {
		return "", err
	}
	return database.JoinDDL(append(blocks, comments)...), nil
}

func serialTypeFor(dtype string) string {
	switch dtype {
	case "smallint":
		return "smallserial"
	case "integer":
		return "serial"
	case "bigint":
		return "bigserial"
	}
	return ""
}

func (s *Session) ddlColumns(ctx context.Context, schema, table string) ([]database.DDLColumn, error) {
	// Only an explicit override emits COLLATE.
	rows, err := s.DB.QueryContext(ctx, `
		SELECT a.attname,
			pg_catalog.format_type(a.atttypid, a.atttypmod),
			a.attnotnull,
			COALESCE(pg_catalog.pg_get_expr(ad.adbin, ad.adrelid), ''),
			a.attidentity,
			a.attgenerated,
			COALESCE(co.collname, ''),
			pg_catalog.pg_get_serial_sequence(
				pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname),
				a.attname) IS NOT NULL
		FROM pg_catalog.pg_attribute a
		JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_catalog.pg_type ty ON ty.oid = a.atttypid
		LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
		LEFT JOIN pg_catalog.pg_collation co ON co.oid = a.attcollation
			AND a.attcollation <> ty.typcollation
		WHERE n.nspname = $1 AND c.relname = $2
		  AND a.attnum > 0 AND NOT a.attisdropped
		ORDER BY a.attnum`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []database.DDLColumn
	for rows.Next() {
		var name, dtype, defaultExpr, identity, generated, collation string
		var notNull, isSerial bool
		if err := rows.Scan(&name, &dtype, &notNull, &defaultExpr, &identity, &generated, &collation, &isSerial); err != nil {
			return nil, err
		}
		col := database.DDLColumn{
			Name: name, Type: dtype, NotNull: notNull, Collation: collation,
		}
		switch {
		case generated == "s":
			// Its expression lives in pg_attrdef, not as a DEFAULT.
			col.Generated = defaultExpr
		case identity == "a":
			col.Identity = "ALWAYS"
		case identity == "d":
			col.Identity = "BY DEFAULT"
		case isSerial && serialTypeFor(dtype) != "":
			// The sequence is dropped with the table, so a nextval() default would not replay.
			col.Type = serialTypeFor(dtype)
		default:
			col.Default = defaultExpr
		}
		cols = append(cols, col)
	}
	return cols, rows.Err()
}

func (s *Session) tableComments(ctx context.Context, schema, table string) (string, error) {
	qualified := database.BuildQualifiedTable(database.DriverPostgres, schema, table)
	rows, err := s.DB.QueryContext(ctx, `
		SELECT COALESCE(a.attname, ''), d.description
		FROM pg_catalog.pg_class c
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_catalog.pg_description d ON d.objoid = c.oid
		LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
			AND NOT a.attisdropped
		WHERE n.nspname = $1 AND c.relname = $2
		  AND (d.objsubid = 0 OR a.attname IS NOT NULL)
		ORDER BY d.objsubid`, schema, table)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var column, description string
		if err := rows.Scan(&column, &description); err != nil {
			return "", err
		}
		target := "TABLE " + qualified
		if column != "" {
			target = "COLUMN " + qualified + "." + database.QuoteIdent(database.DriverPostgres, column)
		}
		lines = append(lines, fmt.Sprintf("COMMENT ON %s IS %s;", target, quoteLiteral(description)))
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return strings.Join(lines, "\n"), nil
}

func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func (s *Session) scalarDDL(ctx context.Context, query, kind, name string, args ...any) (string, error) {
	var def string
	err := s.DB.QueryRowContext(ctx, query, args...).Scan(&def)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("%s %s not found", kind, name)
	}
	if err != nil {
		return "", err
	}
	return database.TerminateStatement(def), nil
}
