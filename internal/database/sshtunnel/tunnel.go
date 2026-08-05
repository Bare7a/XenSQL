// Package sshtunnel dials database connections through an SSH bastion via direct-tcpip channels,
// so there is no local listener to manage.
package sshtunnel

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"
)

type AuthMethod string

const (
	AuthPassword AuthMethod = "password"
	AuthKey      AuthMethod = "key"
	AuthAgent    AuthMethod = "agent"
)

const (
	DefaultPort      = 22
	dialTimeout      = 15 * time.Second
	keepaliveEvery   = 30 * time.Second
	keepaliveRequest = "keepalive@openssh.com"
)

type Config struct {
	Host       string
	Port       int
	User       string
	Auth       AuthMethod
	Password   string
	KeyPath    string
	Passphrase string
	// KnownHosts overrides the default ~/.ssh/known_hosts.
	KnownHosts string
	// IgnoreHostKey accepts any bastion key, leaving the hop open to interception.
	IgnoreHostKey bool
}

func (c Config) addr() string {
	port := c.Port
	if port == 0 {
		port = DefaultPort
	}
	return net.JoinHostPort(c.Host, fmt.Sprint(port))
}

type Tunnel struct {
	client *ssh.Client
	done   chan struct{}
}

// Open establishes the SSH connection; the caller must Close it.
func Open(ctx context.Context, cfg Config) (*Tunnel, error) {
	clientCfg, err := clientConfig(cfg)
	if err != nil {
		return nil, err
	}

	dialer := &net.Dialer{Timeout: dialTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", cfg.addr())
	if err != nil {
		return nil, fmt.Errorf("ssh tunnel: cannot reach bastion %s: %w", cfg.addr(), err)
	}

	// NewClientConn takes no context, so bound the handshake with a deadline.
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(dialTimeout))
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, cfg.addr(), clientCfg)
	if err != nil {
		_ = conn.Close()
		return nil, describeHandshakeError(cfg, err)
	}
	_ = conn.SetDeadline(time.Time{})

	t := &Tunnel{client: ssh.NewClient(c, chans, reqs), done: make(chan struct{})}
	go t.keepalive()
	return t, nil
}

// DialContext matches the dialer signature pgx (DialFunc) and go-sql-driver (RegisterDialContext)
// expect.
func (t *Tunnel) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	conn, err := t.client.DialContext(ctx, network, addr)
	if err != nil {
		return nil, fmt.Errorf("ssh tunnel: cannot reach %s from the bastion: %w", addr, err)
	}
	return tunnelConn{Conn: conn}, nil
}

// tunnelConn absorbs the SetDeadline calls the drivers make mid-query, which a raw SSH channel
// rejects outright. Future deadlines go unenforced (a channel read cannot be interrupted); an
// elapsed one is the drivers' abort signal, so it closes. Query cancellation is server-side
// (pg_cancel_backend / KILL QUERY) and unaffected.
type tunnelConn struct{ net.Conn }

func (c tunnelConn) SetDeadline(t time.Time) error      { return c.abortIfElapsed(t) }
func (c tunnelConn) SetReadDeadline(t time.Time) error  { return c.abortIfElapsed(t) }
func (c tunnelConn) SetWriteDeadline(t time.Time) error { return c.abortIfElapsed(t) }

func (c tunnelConn) abortIfElapsed(t time.Time) error {
	if !t.IsZero() && !t.After(time.Now()) {
		return c.Conn.Close()
	}
	return nil
}

func (t *Tunnel) Close() error {
	select {
	case <-t.done: // already closed
	default:
		close(t.done)
	}
	return t.client.Close()
}

// keepalive stops idle bastions and firewalls from dropping a quiet tunnel.
func (t *Tunnel) keepalive() {
	ticker := time.NewTicker(keepaliveEvery)
	defer ticker.Stop()
	for {
		select {
		case <-t.done:
			return
		case <-ticker.C:
			if _, _, err := t.client.SendRequest(keepaliveRequest, true, nil); err != nil {
				return // gone; pending dials surface the error
			}
		}
	}
}

func clientConfig(cfg Config) (*ssh.ClientConfig, error) {
	if strings.TrimSpace(cfg.Host) == "" {
		return nil, errors.New("ssh tunnel: bastion host is required")
	}
	if strings.TrimSpace(cfg.User) == "" {
		return nil, errors.New("ssh tunnel: bastion username is required")
	}
	auth, err := authMethod(cfg)
	if err != nil {
		return nil, err
	}
	hostKey, err := hostKeyCallback(cfg)
	if err != nil {
		return nil, err
	}
	return &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            []ssh.AuthMethod{auth},
		HostKeyCallback: hostKey,
		Timeout:         dialTimeout,
	}, nil
}

func authMethod(cfg Config) (ssh.AuthMethod, error) {
	switch cfg.Auth {
	case AuthPassword:
		return ssh.Password(cfg.Password), nil
	case AuthAgent:
		return agentAuth()
	case AuthKey, "":
		return keyAuth(cfg)
	default:
		return nil, fmt.Errorf("ssh tunnel: unknown authentication method %q", cfg.Auth)
	}
}

func keyAuth(cfg Config) (ssh.AuthMethod, error) {
	path, err := ExpandPath(cfg.KeyPath)
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, errors.New("ssh tunnel: private key file is required")
	}
	pem, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("ssh tunnel: cannot read private key %s: %w", path, err)
	}
	signer, err := parsePrivateKey(pem, cfg.Passphrase)
	if err != nil {
		return nil, err
	}
	return ssh.PublicKeys(signer), nil
}

func parsePrivateKey(pem []byte, passphrase string) (ssh.Signer, error) {
	if passphrase != "" {
		signer, err := ssh.ParsePrivateKeyWithPassphrase(pem, []byte(passphrase))
		if err != nil {
			return nil, fmt.Errorf("ssh tunnel: cannot decrypt private key (wrong passphrase?): %w", err)
		}
		return signer, nil
	}
	signer, err := ssh.ParsePrivateKey(pem)
	if err != nil {
		var needsPassphrase *ssh.PassphraseMissingError
		if errors.As(err, &needsPassphrase) {
			return nil, errors.New("ssh tunnel: private key is encrypted - enter its passphrase")
		}
		return nil, fmt.Errorf("ssh tunnel: cannot parse private key: %w", err)
	}
	return signer, nil
}

func agentAuth() (ssh.AuthMethod, error) {
	sock := os.Getenv("SSH_AUTH_SOCK")
	if sock == "" {
		return nil, errors.New("ssh tunnel: no ssh-agent found (SSH_AUTH_SOCK is not set)")
	}
	conn, err := net.Dial("unix", sock)
	if err != nil {
		return nil, fmt.Errorf("ssh tunnel: cannot reach ssh-agent: %w", err)
	}
	return ssh.PublicKeysCallback(agent.NewClient(conn).Signers), nil
}

func hostKeyCallback(cfg Config) (ssh.HostKeyCallback, error) {
	if cfg.IgnoreHostKey {
		return ssh.InsecureIgnoreHostKey(), nil //nolint:gosec // user-selected escape hatch, off by default
	}
	path, err := knownHostsPath(cfg)
	if err != nil {
		return nil, err
	}
	callback, err := knownhosts.New(path)
	if err != nil {
		return nil, fmt.Errorf("ssh tunnel: cannot read known_hosts %s: %w", path, err)
	}
	return callback, nil
}

// defaultKnownHostsPath uses the host OS path style, for messages where the home dir is unknown.
func defaultKnownHostsPath() string {
	return filepath.Join("~", ".ssh", "known_hosts")
}

func knownHostsPath(cfg Config) (string, error) {
	if strings.TrimSpace(cfg.KnownHosts) != "" {
		return ExpandPath(cfg.KnownHosts)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("ssh tunnel: cannot locate the home directory for known_hosts: %w", err)
	}
	path := filepath.Join(home, ".ssh", "known_hosts")
	if _, err := os.Stat(path); err != nil {
		return "", fmt.Errorf(
			"ssh tunnel: no known_hosts file at %s - add the bastion with "+
				"`ssh-keyscan -H %s >> %s`, or enable \"Skip host key check\"", path, cfg.Host, path)
	}
	return path, nil
}

// describeHandshakeError names the fix for the two failures users actually hit.
func describeHandshakeError(cfg Config, err error) error {
	var keyErr *knownhosts.KeyError
	if errors.As(err, &keyErr) {
		if len(keyErr.Want) == 0 {
			path, pathErr := knownHostsPath(cfg)
			if pathErr != nil {
				path = defaultKnownHostsPath()
			}
			return fmt.Errorf(
				"ssh tunnel: bastion %s is not in known_hosts - add it with "+
					"`ssh-keyscan -H %s >> %s`, or enable \"Skip host key check\"", cfg.Host, cfg.Host, path)
		}
		return fmt.Errorf(
			"ssh tunnel: host key for %s does not match known_hosts - the bastion key changed, "+
				"or the connection is being intercepted: %w", cfg.Host, err)
	}
	if strings.Contains(err.Error(), "unable to authenticate") {
		return fmt.Errorf("ssh tunnel: bastion rejected the credentials for user %q: %w", cfg.User, err)
	}
	return fmt.Errorf("ssh tunnel: handshake with %s failed: %w", cfg.addr(), err)
}

// ExpandPath resolves a leading ~ so paths can be stored the way users type them.
func ExpandPath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path != "~" && !strings.HasPrefix(path, "~/") && !strings.HasPrefix(path, `~\`) {
		return path, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("ssh tunnel: cannot expand %q: %w", path, err)
	}
	if path == "~" {
		return home, nil
	}
	return filepath.Join(home, path[2:]), nil
}
