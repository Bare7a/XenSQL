package mysql

import (
	"strings"
	"testing"

	"xensql/internal/database"
)

func TestBuildDSN(t *testing.T) {
	dsn, err := buildDSN(database.ConnectionConfig{
		Host:     "127.0.0.1",
		Port:     3306,
		Database: "appdb",
		Username: "root",
		Password: "secret",
		SSLMode:  "disable",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dsn, "root:secret@tcp(127.0.0.1:3306)/appdb") {
		t.Fatalf("unexpected dsn: %s", dsn)
	}
}

func TestBuildConfigTLS(t *testing.T) {
	// require → encrypt but skip verification (user-selected).
	c := buildConfig(database.ConnectionConfig{Host: "db.example.com", SSLMode: "require"})
	if c.TLS == nil || !c.TLS.InsecureSkipVerify {
		t.Fatalf("require should set skip-verify TLS, got %+v", c.TLS)
	}
	// verify-full → verify cert against the hostname (ServerName set, not skipping).
	c = buildConfig(database.ConnectionConfig{Host: "db.example.com", SSLMode: "verify-full"})
	if c.TLS == nil || c.TLS.InsecureSkipVerify || c.TLS.ServerName != "db.example.com" {
		t.Fatalf("verify-full should verify the hostname, got %+v", c.TLS)
	}
	// disable → no TLS.
	if c := buildConfig(database.ConnectionConfig{Host: "db.example.com", SSLMode: "disable"}); c.TLS != nil {
		t.Fatalf("disable should have no TLS, got %+v", c.TLS)
	}
}
