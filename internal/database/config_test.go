package database

import "testing"

func TestDefaultBrowseSchema(t *testing.T) {
	tests := []struct {
		cfg  ConnectionConfig
		want string
	}{
		{ConnectionConfig{Driver: DriverPostgres, Schema: "app"}, "app"},
		{ConnectionConfig{Driver: DriverPostgres}, "public"},
		{ConnectionConfig{Driver: DriverMySQL, Database: "shop"}, "shop"},
		{ConnectionConfig{Driver: DriverSQLite}, "main"},
		{ConnectionConfig{Driver: DriverTurso}, "main"},
	}
	for _, tc := range tests {
		if got := DefaultBrowseSchema(tc.cfg); got != tc.want {
			t.Fatalf("%s: got %q want %q", tc.cfg.Driver, got, tc.want)
		}
	}
}

func TestIsSQLiteFamily(t *testing.T) {
	for _, d := range []DriverType{DriverSQLite, DriverTurso} {
		if !IsSQLiteFamily(d) {
			t.Errorf("%s should be SQLite-family", d)
		}
	}
	for _, d := range []DriverType{DriverPostgres, DriverMySQL, "oracle"} {
		if IsSQLiteFamily(d) {
			t.Errorf("%s should not be SQLite-family", d)
		}
	}
}
