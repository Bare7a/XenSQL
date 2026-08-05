package app

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestGetPathDefaultsMatchesTheHost(t *testing.T) {
	a := &App{}
	got := a.GetPathDefaults()

	if got.Platform != runtime.GOOS {
		t.Fatalf("platform = %q, want %q", got.Platform, runtime.GOOS)
	}
	if got.Separator != string(os.PathSeparator) {
		t.Fatalf("separator = %q, want %q", got.Separator, string(os.PathSeparator))
	}

	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home directory on this host")
	}
	if want := filepath.Join(home, ".ssh", "id_ed25519"); got.SSHKey != want {
		t.Fatalf("sshKey = %q, want %q", got.SSHKey, want)
	}
	if want := filepath.Join(home, ".ssh", "known_hosts"); got.SSHKnownHosts != want {
		t.Fatalf("sshKnownHosts = %q, want %q", got.SSHKnownHosts, want)
	}
}

// The UI must never show another platform's path style.
func TestGetPathDefaultsUsesHostPathStyle(t *testing.T) {
	got := (&App{}).GetPathDefaults()
	if got.SSHKey == "" {
		t.Skip("no home directory on this host")
	}

	foreign := "/"
	if os.PathSeparator == '/' {
		foreign = `\`
	}
	for name, path := range map[string]string{"sshKey": got.SSHKey, "sshKnownHosts": got.SSHKnownHosts} {
		if !strings.Contains(path, got.Separator) {
			t.Fatalf("%s = %q does not use the host separator %q", name, path, got.Separator)
		}
		if strings.Contains(path, foreign) {
			t.Fatalf("%s = %q contains the foreign separator %q", name, path, foreign)
		}
	}
}
