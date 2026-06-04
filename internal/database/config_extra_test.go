package database

import (
	"strings"
	"testing"
)

func TestNormalizeConnectionConfigTrims(t *testing.T) {
	cfg := ConnectionConfig{
		Name:     "  prod ",
		FilePath: " ./data.db ",
		Host:     " localhost\n",
		Database: "\tshop ",
		Username: " admin ",
		SSLMode:  " require ",
		Schema:   " public ",
		Password: " secret ", // password is intentionally left untouched
	}
	NormalizeConnectionConfig(&cfg)
	if cfg.Name != "prod" || cfg.FilePath != "./data.db" || cfg.Host != "localhost" ||
		cfg.Database != "shop" || cfg.Username != "admin" || cfg.SSLMode != "require" ||
		cfg.Schema != "public" {
		t.Fatalf("trim failed: %+v", cfg)
	}
	if cfg.Password != " secret " {
		t.Fatalf("password must not be trimmed (leading/trailing space can be intentional), got %q", cfg.Password)
	}
}

func TestValidateConnectionConfig(t *testing.T) {
	tests := []struct {
		name    string
		cfg     ConnectionConfig
		wantErr string // substring; empty = expect no error
	}{
		{"sqlite ok", ConnectionConfig{Driver: DriverSQLite, FilePath: "x.db"}, ""},
		{"sqlite missing file", ConnectionConfig{Driver: DriverSQLite}, "file path"},
		{"postgres ok", ConnectionConfig{Driver: DriverPostgres, Host: "h", Database: "d", Username: "u"}, ""},
		{"postgres missing host", ConnectionConfig{Driver: DriverPostgres, Database: "d", Username: "u"}, "host"},
		{"postgres missing db", ConnectionConfig{Driver: DriverPostgres, Host: "h", Username: "u"}, "database"},
		{"postgres missing user", ConnectionConfig{Driver: DriverPostgres, Host: "h", Database: "d"}, "username"},
		{"mysql ok", ConnectionConfig{Driver: DriverMySQL, Host: "h", Database: "d", Username: "u"}, ""},
		{"mysql missing host", ConnectionConfig{Driver: DriverMySQL, Database: "d", Username: "u"}, "host"},
		{"unknown driver", ConnectionConfig{Driver: "oracle"}, "unsupported"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateConnectionConfig(tc.cfg)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("expected nil error, got %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestConfigFingerprintChangesWithEveryRelevantField(t *testing.T) {
	base := ConnectionConfig{
		ID: "id-1", Driver: DriverPostgres, Host: "h", Port: 5432, Database: "d",
		Username: "u", Password: "p", SSLMode: "require", FilePath: "", Schema: "s",
		ReadOnly: false,
	}
	baseFP := ConfigFingerprint(base)

	// Cosmetic-only edits (rename/recolor) must not force a pool reconnect.
	cosmetic := base
	cosmetic.Name = "different name"
	cosmetic.Color = "#ff0000"
	cosmetic.FolderID = "f-1"
	if ConfigFingerprint(cosmetic) != baseFP {
		t.Fatal("cosmetic fields should not change fingerprint")
	}

	mutations := []struct {
		name string
		mut  func(*ConnectionConfig)
	}{
		{"driver", func(c *ConnectionConfig) { c.Driver = DriverMySQL }},
		{"host", func(c *ConnectionConfig) { c.Host = "h2" }},
		{"port", func(c *ConnectionConfig) { c.Port = 5433 }},
		{"database", func(c *ConnectionConfig) { c.Database = "d2" }},
		{"username", func(c *ConnectionConfig) { c.Username = "u2" }},
		{"password", func(c *ConnectionConfig) { c.Password = "p2" }},
		{"sslMode", func(c *ConnectionConfig) { c.SSLMode = "disable" }},
		{"filePath", func(c *ConnectionConfig) { c.FilePath = "x.db" }},
		{"schema", func(c *ConnectionConfig) { c.Schema = "s2" }},
		{"readOnly", func(c *ConnectionConfig) { c.ReadOnly = true }},
	}
	for _, m := range mutations {
		t.Run(m.name, func(t *testing.T) {
			c := base
			m.mut(&c)
			if ConfigFingerprint(c) == baseFP {
				t.Fatalf("changing %s should change fingerprint", m.name)
			}
		})
	}
}
