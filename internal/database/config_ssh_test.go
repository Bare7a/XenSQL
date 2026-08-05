package database

import (
	"strings"
	"testing"
)

func baseSSHConn() ConnectionConfig {
	return ConnectionConfig{
		Driver:   DriverPostgres,
		Host:     "db.internal",
		Database: "app",
		Username: "postgres",
	}
}

func TestNormalizeSSHConfigTrimsAndDefaults(t *testing.T) {
	cfg := baseSSHConn()
	cfg.SSH = SSHConfig{
		Enabled:    true,
		Host:       "  bastion.example.com  ",
		Username:   "  deploy ",
		KeyPath:    "  ~/.ssh/id_ed25519 ",
		KnownHosts: " ~/.ssh/known_hosts ",
	}
	NormalizeConnectionConfig(&cfg)

	if cfg.SSH.Host != "bastion.example.com" {
		t.Fatalf("host not trimmed: %q", cfg.SSH.Host)
	}
	if cfg.SSH.Username != "deploy" {
		t.Fatalf("username not trimmed: %q", cfg.SSH.Username)
	}
	if cfg.SSH.KeyPath != "~/.ssh/id_ed25519" {
		t.Fatalf("key path not trimmed: %q", cfg.SSH.KeyPath)
	}
	if cfg.SSH.KnownHosts != "~/.ssh/known_hosts" {
		t.Fatalf("known hosts not trimmed: %q", cfg.SSH.KnownHosts)
	}
	if cfg.SSH.Port != 22 {
		t.Fatalf("port should default to 22, got %d", cfg.SSH.Port)
	}
	if cfg.SSH.Auth != SSHAuthKey {
		t.Fatalf("auth should default to key, got %q", cfg.SSH.Auth)
	}
}

func TestNormalizeKeepsExplicitSSHPort(t *testing.T) {
	cfg := baseSSHConn()
	cfg.SSH = SSHConfig{Enabled: true, Host: "b", Username: "u", Port: 2222, Auth: SSHAuthAgent}
	NormalizeConnectionConfig(&cfg)
	if cfg.SSH.Port != 2222 {
		t.Fatalf("explicit port overwritten: %d", cfg.SSH.Port)
	}
	if cfg.SSH.Auth != SSHAuthAgent {
		t.Fatalf("explicit auth overwritten: %q", cfg.SSH.Auth)
	}
}

func TestValidateSSHConfig(t *testing.T) {
	tests := []struct {
		name    string
		ssh     SSHConfig
		wantErr string
	}{
		{"disabled ignores empty fields", SSHConfig{}, ""},
		{"disabled ignores invalid fields", SSHConfig{Port: 99999}, ""},
		{"key auth is complete", SSHConfig{Enabled: true, Host: "b", Username: "u", Auth: SSHAuthKey, KeyPath: "/k"}, ""},
		{"agent auth needs no key", SSHConfig{Enabled: true, Host: "b", Username: "u", Auth: SSHAuthAgent}, ""},
		{"password auth needs no key", SSHConfig{Enabled: true, Host: "b", Username: "u", Auth: SSHAuthPassword}, ""},
		{"missing host", SSHConfig{Enabled: true, Username: "u", Auth: SSHAuthAgent}, "SSH host is required"},
		{"missing user", SSHConfig{Enabled: true, Host: "b", Auth: SSHAuthAgent}, "SSH username is required"},
		{"missing key", SSHConfig{Enabled: true, Host: "b", Username: "u", Auth: SSHAuthKey}, "private key file is required"},
		{"empty auth defaults to key", SSHConfig{Enabled: true, Host: "b", Username: "u"}, "private key file is required"},
		{"bad port", SSHConfig{Enabled: true, Host: "b", Username: "u", Auth: SSHAuthAgent, Port: 70000}, "between 1 and 65535"},
		{"bad method", SSHConfig{Enabled: true, Host: "b", Username: "u", Auth: "telepathy"}, "unsupported SSH authentication"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := baseSSHConn()
			cfg.SSH = tc.ssh
			err := ValidateConnectionConfig(cfg)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected an error containing %q", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("got %v, want it to contain %q", err, tc.wantErr)
			}
		})
	}
}

// A direct connection keeps an empty SSH block rather than gaining defaults it never uses.
func TestNormalizeLeavesDisabledSSHUntouched(t *testing.T) {
	cfg := baseSSHConn()
	NormalizeConnectionConfig(&cfg)
	if cfg.SSH != (SSHConfig{}) {
		t.Fatalf("disabled SSH should stay zero, got %+v", cfg.SSH)
	}
}

// A leftover SSH block from another driver must not block SQLite.
func TestValidateIgnoresSSHForSQLite(t *testing.T) {
	cfg := ConnectionConfig{Driver: DriverSQLite, FilePath: "/tmp/app.db"}
	cfg.SSH = SSHConfig{Enabled: true} // incomplete on purpose
	if err := ValidateConnectionConfig(cfg); err != nil {
		t.Fatalf("SQLite should ignore SSH settings, got %v", err)
	}
}

// The pool reuses a session while the fingerprint is unchanged, so every SSH field must alter it.
func TestConfigFingerprintCoversSSHFields(t *testing.T) {
	base := baseSSHConn()
	base.SSH = SSHConfig{
		Enabled: true, Host: "bastion", Port: 22, Username: "deploy",
		Auth: SSHAuthKey, KeyPath: "/keys/id", Passphrase: "pp",
		KnownHosts: "/kh", Password: "pw",
	}
	baseFP := ConfigFingerprint(base)

	mutations := map[string]func(*ConnectionConfig){
		"enabled":       func(c *ConnectionConfig) { c.SSH.Enabled = false },
		"host":          func(c *ConnectionConfig) { c.SSH.Host = "other" },
		"port":          func(c *ConnectionConfig) { c.SSH.Port = 2222 },
		"username":      func(c *ConnectionConfig) { c.SSH.Username = "root" },
		"auth":          func(c *ConnectionConfig) { c.SSH.Auth = SSHAuthAgent },
		"password":      func(c *ConnectionConfig) { c.SSH.Password = "other" },
		"keyPath":       func(c *ConnectionConfig) { c.SSH.KeyPath = "/keys/other" },
		"passphrase":    func(c *ConnectionConfig) { c.SSH.Passphrase = "other" },
		"knownHosts":    func(c *ConnectionConfig) { c.SSH.KnownHosts = "/other" },
		"ignoreHostKey": func(c *ConnectionConfig) { c.SSH.IgnoreHostKey = true },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			cfg := base
			mutate(&cfg)
			if ConfigFingerprint(cfg) == baseFP {
				t.Fatalf("changing SSH %s did not change the fingerprint - the pool would reuse a stale session", name)
			}
		})
	}

	same := base
	if ConfigFingerprint(same) != baseFP {
		t.Fatal("fingerprint is not stable for an unchanged config")
	}
}

// Drivers call OpenTunnel unconditionally, so a disabled tunnel must open nothing.
func TestOpenTunnelSkippedWhenDisabled(t *testing.T) {
	cfg := baseSSHConn()
	cfg.SSH = SSHConfig{Enabled: false, Host: "unreachable.invalid", Username: "u", Auth: SSHAuthAgent}
	tunnel, err := OpenTunnel(t.Context(), cfg)
	if err != nil {
		t.Fatalf("expected no error for a disabled tunnel, got %v", err)
	}
	if tunnel != nil {
		t.Fatal("expected no tunnel for a disabled config")
	}
}
