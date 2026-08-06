package mysql

import "testing"

func TestColumnIndex(t *testing.T) {
	table := []string{"Table", "Create Table"}
	view := []string{"View", "Create View", "character_set_client", "collation_connection"}
	trigger := []string{
		"Trigger", "sql_mode", "SQL Original Statement",
		"character_set_client", "collation_connection", "Database Collation", "Created",
	}
	routine := []string{
		"Procedure", "sql_mode", "Create Procedure",
		"character_set_client", "collation_connection", "Database Collation",
	}

	tests := []struct {
		name string
		cols []string
		want int
		def  string
	}{
		{"table", table, 1, "Create Table"},
		{"view", view, 1, "Create View"},
		// Picking the "Created" column returned a date instead of the statement.
		{"trigger", trigger, 2, "SQL Original Statement"},
		{"procedure", routine, 2, "Create Procedure"},
		{"name match is case-insensitive", table, 1, "CREATE TABLE"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := columnIndex(tc.cols, tc.def); got != tc.want {
				t.Errorf("columnIndex(%v, %q) = %d, want %d", tc.cols, tc.def, got, tc.want)
			}
		})
	}
}

func TestColumnIndexFallbackSkipsCreatedTimestamp(t *testing.T) {
	cols := []string{"Trigger", "sql_mode", "Create Trigger", "Created"}
	if got := columnIndex(cols, "Renamed Column"); got != 2 {
		t.Errorf("fallback picked %d, want 2 (the Create* column, not Created)", got)
	}

	if got := columnIndex([]string{"Trigger", "Created"}, "Nope"); got != -1 {
		t.Errorf("columnIndex = %d, want -1", got)
	}
}
