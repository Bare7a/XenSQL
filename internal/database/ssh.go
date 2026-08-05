package database

import (
	"context"

	"xensql/internal/database/sshtunnel"
)

// OpenTunnel returns (nil, nil) when the connection dials the database directly. A non-nil Tunnel
// must be closed with the session via SessionBase.OnClose.
func OpenTunnel(ctx context.Context, cfg ConnectionConfig) (*sshtunnel.Tunnel, error) {
	if !cfg.SSH.Enabled {
		return nil, nil
	}
	return sshtunnel.Open(ctx, sshtunnel.Config{
		Host:          cfg.SSH.Host,
		Port:          cfg.SSH.Port,
		User:          cfg.SSH.Username,
		Auth:          sshtunnel.AuthMethod(cfg.SSH.Auth),
		Password:      cfg.SSH.Password,
		KeyPath:       cfg.SSH.KeyPath,
		Passphrase:    cfg.SSH.Passphrase,
		KnownHosts:    cfg.SSH.KnownHosts,
		IgnoreHostKey: cfg.SSH.IgnoreHostKey,
	})
}
