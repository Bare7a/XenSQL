package database

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// Catalog discovery shared by the SQLite-family drivers: SQLite and Turso expose the same
// sqlite_master table and PRAGMA introspection.

// SQLiteListTables lists the user tables and views of the single "main" schema.
func SQLiteListTables(ctx context.Context, db *sql.DB) ([]TableInfo, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT type, name FROM sqlite_master
		WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
		ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tables []TableInfo
	for rows.Next() {
		var typ, name string
		if err := rows.Scan(&typ, &name); err != nil {
			return nil, err
		}
		tables = append(tables, TableInfo{Schema: "main", Name: name, Type: typ})
	}
	return tables, rows.Err()
}

// SQLiteListColumns describes table from PRAGMA table_info, merged with its foreign-key targets.
func SQLiteListColumns(ctx context.Context, db *sql.DB, driver DriverType, table string) ([]ColumnInfo, error) {
	fkCols, err := sqliteForeignKeyColumns(ctx, db, driver, table)
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info(%s)", QuoteIdent(driver, table)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []ColumnInfo
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		fk := fkCols[name]
		cols = append(cols, ColumnInfo{
			Name:          name,
			DataType:      ctype,
			IsNullable:    notnull == 0,
			IsPrimary:     pk > 0,
			IsForeign:     fk.table != "",
			ForeignTable:  fk.table,
			ForeignColumn: fk.column,
			DefaultVal:    dflt.String,
		})
	}
	return cols, rows.Err()
}

type sqliteFKTarget struct {
	table  string
	column string
}

// sqliteForeignKeyColumns maps local column names to their FK target. PRAGMA table_info doesn't
// expose foreign keys, so they come from PRAGMA foreign_key_list.
func sqliteForeignKeyColumns(ctx context.Context, db *sql.DB, driver DriverType, table string) (map[string]sqliteFKTarget, error) {
	rows, err := db.QueryContext(ctx, fmt.Sprintf("PRAGMA foreign_key_list(%s)", QuoteIdent(driver, table)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fks := make(map[string]sqliteFKTarget)
	for rows.Next() {
		var id, seq int
		var refTable, from string
		var to sql.NullString // null when the FK references the target's primary key implicitly
		var onUpdate, onDelete, matchType string
		if err := rows.Scan(&id, &seq, &refTable, &from, &to, &onUpdate, &onDelete, &matchType); err != nil {
			return nil, err
		}
		if _, seen := fks[from]; !seen {
			fks[from] = sqliteFKTarget{table: refTable, column: to.String}
		}
	}
	return fks, rows.Err()
}

// SQLiteInsertRow inserts values and re-fetches the stored record so defaults and computed columns
// come back, matching Postgres RETURNING *.
func SQLiteInsertRow(ctx context.Context, db *sql.DB, driver DriverType, schema, table string, values map[string]any) (map[string]any, error) {
	q, args, err := BuildInsertSQL(driver, schema, table, values)
	if err != nil {
		return nil, err
	}
	res, err := db.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if id > 0 {
		return sqliteFetchInsertedRow(ctx, db, driver, schema, table, id)
	}
	if row, ok := sqliteFetchInsertedByValues(ctx, db, driver, table, values); ok {
		return row, nil
	}
	return map[string]any{}, nil
}

// sqliteFetchInsertedRow looks the row up by integer PK using the rowid, falling back to
// {"rowid": id} on failure.
func sqliteFetchInsertedRow(ctx context.Context, db *sql.DB, driver DriverType, schema, table string, rowid int64) (map[string]any, error) {
	if cols, err := SQLiteListColumns(ctx, db, driver, table); err == nil {
		if row, ok := SelectRowByIntegerPK(ctx, db, driver, schema, table, cols, rowid); ok {
			return row, nil
		}
	}
	return map[string]any{"rowid": rowid}, nil
}

// sqliteFetchInsertedByValues is the fallback for LastInsertId==0 (non-INTEGER PK): an exact-match
// lookup on the user-supplied values.
func sqliteFetchInsertedByValues(ctx context.Context, db *sql.DB, driver DriverType, table string, values map[string]any) (map[string]any, bool) {
	if len(values) == 0 {
		return nil, false
	}
	where := make([]string, 0, len(values))
	args := make([]any, 0, len(values))
	for col, val := range values {
		where = append(where, fmt.Sprintf("%s = ?", QuoteIdent(driver, col)))
		args = append(args, val)
	}
	q := fmt.Sprintf("SELECT * FROM %s WHERE %s LIMIT 1",
		QuoteIdent(driver, table),
		strings.Join(where, " AND "))
	return SelectSingleRow(ctx, db, q, args...)
}
