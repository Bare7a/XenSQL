package database

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

func NormalizeConnectionConfig(cfg *ConnectionConfig) {
	cfg.Name = strings.TrimSpace(cfg.Name)
	cfg.FilePath = strings.TrimSpace(cfg.FilePath)
	cfg.Host = strings.TrimSpace(cfg.Host)
	cfg.Database = strings.TrimSpace(cfg.Database)
	cfg.Username = strings.TrimSpace(cfg.Username)
	cfg.SSLMode = strings.TrimSpace(cfg.SSLMode)
	cfg.Schema = strings.TrimSpace(cfg.Schema)
}

func ValidateConnectionConfig(cfg ConnectionConfig) error {
	switch cfg.Driver {
	case DriverSQLite:
		if cfg.FilePath == "" {
			return fmt.Errorf("SQLite database file path is required")
		}
	case DriverPostgres:
		if cfg.Host == "" {
			return fmt.Errorf("host is required")
		}
		if cfg.Database == "" {
			return fmt.Errorf("database name is required (e.g. blog - not the username \"postgres\")")
		}
		if cfg.Username == "" {
			return fmt.Errorf("username is required")
		}
	case DriverMySQL:
		if cfg.Host == "" {
			return fmt.Errorf("host is required")
		}
		if cfg.Database == "" {
			return fmt.Errorf("database name is required")
		}
		if cfg.Username == "" {
			return fmt.Errorf("username is required")
		}
	default:
		return fmt.Errorf("unsupported driver: %s", cfg.Driver)
	}
	return nil
}

func DefaultBrowseSchema(cfg ConnectionConfig) string {
	if cfg.Schema != "" {
		return cfg.Schema
	}
	switch cfg.Driver {
	case DriverSQLite:
		return "main"
	case DriverMySQL:
		return cfg.Database
	default:
		return "public"
	}
}

// SHA-256 digest of connection settings so passwords never appear as plain substrings in logs.
func ConfigFingerprint(cfg ConnectionConfig) string {
	raw := fmt.Sprintf(
		"%s|%s|%d|%s|%s|%s|%s|%s|%s|%t",
		cfg.Driver,
		cfg.Host,
		cfg.Port,
		cfg.Database,
		cfg.Username,
		cfg.Password,
		cfg.SSLMode,
		cfg.FilePath,
		cfg.Schema,
		cfg.ReadOnly,
	)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
