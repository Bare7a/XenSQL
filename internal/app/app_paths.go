package app

import (
	"os"
	"path/filepath"
	"runtime"
)

// PathDefaults lets the UI show example paths that match the host, not one platform's convention.
type PathDefaults struct {
	Platform  string `json:"platform"`
	Separator string `json:"separator"`
	// SSHKey and SSHKnownHosts are empty when the home directory cannot be resolved.
	SSHKey        string `json:"sshKey,omitempty"`
	SSHKnownHosts string `json:"sshKnownHosts,omitempty"`
}

func (a *App) GetPathDefaults() PathDefaults {
	d := PathDefaults{
		Platform:  runtime.GOOS,
		Separator: string(os.PathSeparator),
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return d
	}
	d.SSHKey = filepath.Join(home, ".ssh", "id_ed25519")
	d.SSHKnownHosts = filepath.Join(home, ".ssh", "known_hosts")
	return d
}
