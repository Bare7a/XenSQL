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
	normalizeSSHConfig(&cfg.SSH)
}

func normalizeSSHConfig(ssh *SSHConfig) {
	ssh.Host = strings.TrimSpace(ssh.Host)
	ssh.Username = strings.TrimSpace(ssh.Username)
	ssh.KeyPath = strings.TrimSpace(ssh.KeyPath)
	ssh.KnownHosts = strings.TrimSpace(ssh.KnownHosts)
	// Defaults only once the tunnel is on, so direct connections keep an empty block.
	if !ssh.Enabled {
		return
	}
	if ssh.Port == 0 {
		ssh.Port = 22
	}
	if ssh.Auth == "" {
		ssh.Auth = SSHAuthKey
	}
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
	// SQLite reads a local file, so leftover SSH settings cannot affect it.
	if cfg.Driver != DriverSQLite {
		return validateSSHConfig(cfg.SSH)
	}
	return nil
}

func validateSSHConfig(ssh SSHConfig) error {
	if !ssh.Enabled {
		return nil
	}
	if ssh.Host == "" {
		return fmt.Errorf("SSH host is required")
	}
	if ssh.Username == "" {
		return fmt.Errorf("SSH username is required")
	}
	if ssh.Port < 0 || ssh.Port > 65535 {
		return fmt.Errorf("SSH port must be between 1 and 65535")
	}
	switch ssh.Auth {
	case SSHAuthKey, "":
		if ssh.KeyPath == "" {
			return fmt.Errorf("SSH private key file is required")
		}
	case SSHAuthPassword, SSHAuthAgent:
	default:
		return fmt.Errorf("unsupported SSH authentication method: %s", ssh.Auth)
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
		"%s|%s|%d|%s|%s|%s|%s|%s|%s|%t|%t|%s|%d|%s|%s|%s|%s|%s|%s|%t",
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
		// SSH changes which server the session reaches, so it must invalidate a pooled session.
		cfg.SSH.Enabled,
		cfg.SSH.Host,
		cfg.SSH.Port,
		cfg.SSH.Username,
		cfg.SSH.Auth,
		cfg.SSH.Password,
		cfg.SSH.KeyPath,
		cfg.SSH.Passphrase,
		cfg.SSH.KnownHosts,
		cfg.SSH.IgnoreHostKey,
	)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
