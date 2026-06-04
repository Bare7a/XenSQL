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
	}
	for _, tc := range tests {
		if got := DefaultBrowseSchema(tc.cfg); got != tc.want {
			t.Fatalf("%s: got %q want %q", tc.cfg.Driver, got, tc.want)
		}
	}
}
