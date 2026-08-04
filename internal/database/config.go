package database

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
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
	cfg.RemoteURL = strings.TrimSpace(cfg.RemoteURL)
	cfg.AuthToken = strings.TrimSpace(cfg.AuthToken)
	cfg.ExperimentalFeatures = normalizeCSV(cfg.ExperimentalFeatures)
}

// normalizeCSV trims entries and drops blanks: "views, encryption " becomes "views,encryption".
func normalizeCSV(list string) string {
	parts := strings.Split(list, ",")
	kept := parts[:0]
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, ",")
}

func ValidateConnectionConfig(cfg ConnectionConfig) error {
	switch cfg.Driver {
	case DriverSQLite:
		if cfg.FilePath == "" {
			return fmt.Errorf("SQLite database file path is required")
		}
	case DriverTurso:
		if cfg.FilePath == "" {
			return fmt.Errorf("Turso database file path is required (the local database, or the local replica when syncing)")
		}
		if err := validateTursoRemoteURL(cfg.RemoteURL); err != nil {
			return err
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

// validateTursoRemoteURL allows an empty URL (local-only) and otherwise requires http/https, the
// schemes the sync engine speaks - a typo would otherwise surface from inside the sync bootstrap.
func validateTursoRemoteURL(remote string) error {
	if remote == "" {
		return nil
	}
	u, err := url.Parse(remote)
	if err != nil {
		return fmt.Errorf("invalid Turso remote URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("Turso remote URL must start with https:// (got %q)", remote)
	}
	if u.Host == "" {
		return fmt.Errorf("Turso remote URL is missing a host (got %q)", remote)
	}
	return nil
}

func DefaultBrowseSchema(cfg ConnectionConfig) string {
	if cfg.Schema != "" {
		return cfg.Schema
	}
	switch {
	case IsSQLiteFamily(cfg.Driver):
		return "main"
	case cfg.Driver == DriverMySQL:
		return cfg.Database
	default:
		return "public"
	}
}

// SHA-256 digest of connection settings so passwords never appear as plain substrings in logs.
func ConfigFingerprint(cfg ConnectionConfig) string {
	raw := fmt.Sprintf(
		"%s|%s|%d|%s|%s|%s|%s|%s|%s|%t|%s|%s|%s",
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
		cfg.RemoteURL,
		cfg.AuthToken,
		cfg.ExperimentalFeatures,
	)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
