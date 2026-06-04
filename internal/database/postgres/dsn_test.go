package postgres

import (
	"strings"
	"testing"

	"xensql/internal/database"
)

func TestBuildDSN_emptyPasswordOmitsPasswordKey(t *testing.T) {
	dsn := buildDSN(database.ConnectionConfig{
		Host:     "localhost",
		Port:     5432,
		Username: "postgres",
		Password: "",
		Database: "blog",
		SSLMode:  "disable",
	})
	if strings.Contains(dsn, "password=") {
		t.Fatalf("DSN must not include empty password=: %q", dsn)
	}
	if !strings.Contains(dsn, "blog") {
		t.Fatalf("DSN must target blog: %q", dsn)
	}
}

func TestBuildDSN_withPassword(t *testing.T) {
	dsn := buildDSN(database.ConnectionConfig{
		Host:     "localhost",
		Port:     5432,
		Username: "postgres",
		Password: "secret",
		Database: "blog",
		SSLMode:  "disable",
	})
	if !strings.Contains(dsn, "secret") {
		t.Fatalf("DSN must include password: %q", dsn)
	}
}
