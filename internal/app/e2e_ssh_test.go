//go:build e2e

package app

import (
	"crypto/ed25519"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"

	"xensql/internal/database"
)

// These point the real drivers at the real engines through an in-process SSH bastion, exercising
// the pgx DialFunc and go-sql-driver RegisterDialContext wiring end to end.

type bastion struct {
	addr    string
	hostKey ssh.PublicKey
	user    string
	pass    string
}

func startBastion(t *testing.T) bastion {
	t.Helper()

	_, hostPriv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate host key: %v", err)
	}
	hostSigner, err := ssh.NewSignerFromKey(hostPriv)
	if err != nil {
		t.Fatalf("host signer: %v", err)
	}

	b := bastion{hostKey: hostSigner.PublicKey(), user: "tunnel", pass: "tunnel-pw"}
	cfg := &ssh.ServerConfig{
		PasswordCallback: func(meta ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if meta.User() != b.user || string(pass) != b.pass {
				return nil, errors.New("denied")
			}
			return nil, nil
		},
	}
	cfg.AddHostKey(hostSigner)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go serveBastion(conn, cfg)
		}
	}()

	b.addr = ln.Addr().String()
	return b
}

func serveBastion(conn net.Conn, cfg *ssh.ServerConfig) {
	sshConn, chans, reqs, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		_ = conn.Close()
		return
	}
	defer sshConn.Close()
	go ssh.DiscardRequests(reqs)
	for newCh := range chans {
		if newCh.ChannelType() != "direct-tcpip" {
			_ = newCh.Reject(ssh.UnknownChannelType, "only direct-tcpip")
			continue
		}
		var payload struct {
			DestHost string
			DestPort uint32
			SrcHost  string
			SrcPort  uint32
		}
		if err := ssh.Unmarshal(newCh.ExtraData(), &payload); err != nil {
			_ = newCh.Reject(ssh.ConnectionFailed, "bad payload")
			continue
		}
		target, err := net.Dial("tcp", net.JoinHostPort(payload.DestHost, fmt.Sprint(payload.DestPort)))
		if err != nil {
			_ = newCh.Reject(ssh.ConnectionFailed, err.Error())
			continue
		}
		ch, chReqs, err := newCh.Accept()
		if err != nil {
			_ = target.Close()
			continue
		}
		go ssh.DiscardRequests(chReqs)
		go func() {
			defer ch.Close()
			defer target.Close()
			go func() { _, _ = io.Copy(target, ch) }()
			_, _ = io.Copy(ch, target)
		}()
	}
}

// knownHostsFor exercises real host key verification rather than the IgnoreHostKey escape hatch.
func (b bastion) knownHostsFor(t *testing.T) string {
	t.Helper()
	host, port, err := net.SplitHostPort(b.addr)
	if err != nil {
		t.Fatalf("split addr: %v", err)
	}
	path := filepath.Join(t.TempDir(), "known_hosts")
	entry := fmt.Sprintf("[%s]:%s %s", host, port, string(ssh.MarshalAuthorizedKey(b.hostKey)))
	if err := os.WriteFile(path, []byte(entry), 0o600); err != nil {
		t.Fatalf("write known_hosts: %v", err)
	}
	return path
}

func (b bastion) sshConfig(t *testing.T) database.SSHConfig {
	t.Helper()
	host, portStr, err := net.SplitHostPort(b.addr)
	if err != nil {
		t.Fatalf("split addr: %v", err)
	}
	var port int
	if _, err := fmt.Sscanf(portStr, "%d", &port); err != nil {
		t.Fatalf("parse port: %v", err)
	}
	return database.SSHConfig{
		Enabled:    true,
		Host:       host,
		Port:       port,
		Username:   b.user,
		Auth:       database.SSHAuthPassword,
		Password:   b.pass,
		KnownHosts: b.knownHostsFor(t),
	}
}

// tunnelledConn saves a connection that reaches the engine through the bastion.
func tunnelledConn(t *testing.T, a *App, e engine, ssh database.SSHConfig) string {
	t.Helper()
	cfg := e.config()
	cfg.Name = "e2e-ssh-" + e.name
	cfg.SSH = ssh
	saved, err := a.SaveConnection(cfg)
	if err != nil {
		t.Fatalf("save tunnelled connection: %v", err)
	}
	return saved.ID
}

func TestSSHTunnelQueriesEachEngine(t *testing.T) {
	for _, e := range allEngines() {
		t.Run(e.name, func(t *testing.T) {
			a := appForTest(t)
			requireEngine(t, a, e) // skips when the engine is not up

			b := startBastion(t)
			connID := tunnelledConn(t, a, e, b.sshConfig(t))

			if err := a.Connect(connID); err != nil {
				t.Fatalf("connect through the tunnel: %v", err)
			}
			defer a.Disconnect(connID)

			res, err := a.ExecuteQuery(connID, "SELECT 1 AS one")
			if err != nil {
				t.Fatalf("query through the tunnel: %v", err)
			}
			if len(res.Rows) != 1 || len(res.Rows[0]) != 1 {
				t.Fatalf("expected a single 1x1 row, got %+v", res.Rows)
			}

			// The schema explorer shares the session, so it must survive the tunnel too.
			if _, err := a.LoadSchemaData(connID); err != nil {
				t.Fatalf("load schema through the tunnel: %v", err)
			}

			status, err := a.GetConnectionStatus(connID)
			if err != nil {
				t.Fatalf("status: %v", err)
			}
			if !status.Connected {
				t.Fatal("status reports the tunnelled connection as disconnected")
			}
		})
	}
}

// Proves the connection is bidirectional and pooled, not good for a single round trip.
func TestSSHTunnelSurvivesWritesAndReconnect(t *testing.T) {
	for _, e := range allEngines() {
		t.Run(e.name, func(t *testing.T) {
			a := appForTest(t)
			requireEngine(t, a, e)

			b := startBastion(t)
			connID := tunnelledConn(t, a, e, b.sshConfig(t))
			if err := a.Connect(connID); err != nil {
				t.Fatalf("connect: %v", err)
			}

			table := uniqueTable("ssh_tunnel")
			mustExec(t, a, connID, e.autoPKTable(table))
			defer func() { _, _ = a.ExecuteQuery(connID, "DROP TABLE "+table) }()

			mustExec(t, a, connID, fmt.Sprintf("INSERT INTO %s (name) VALUES ('through-the-tunnel')", table))
			res, err := a.ExecuteQuery(connID, "SELECT name FROM "+table)
			if err != nil {
				t.Fatalf("select: %v", err)
			}
			if len(res.Rows) != 1 {
				t.Fatalf("expected 1 row, got %d", len(res.Rows))
			}

			// Disconnect tears the tunnel down; reconnecting must build a fresh one.
			a.Disconnect(connID)
			if err := a.Connect(connID); err != nil {
				t.Fatalf("reconnect through a new tunnel: %v", err)
			}
			defer a.Disconnect(connID)
			if _, err := a.ExecuteQuery(connID, "SELECT name FROM "+table); err != nil {
				t.Fatalf("query after reconnect: %v", err)
			}
		})
	}
}

func TestSSHTunnelRejectsUnknownBastionKey(t *testing.T) {
	e := allEngines()[0]
	a := appForTest(t)
	requireEngine(t, a, e)

	b := startBastion(t)
	sshCfg := b.sshConfig(t)
	// An empty known_hosts leaves the bastion unrecognised.
	empty := filepath.Join(t.TempDir(), "known_hosts")
	if err := os.WriteFile(empty, []byte(""), 0o600); err != nil {
		t.Fatalf("write known_hosts: %v", err)
	}
	sshCfg.KnownHosts = empty

	connID := tunnelledConn(t, a, e, sshCfg)
	err := a.Connect(connID)
	if err == nil {
		a.Disconnect(connID)
		t.Fatal("expected the unknown bastion key to be rejected")
	}
	if !strings.Contains(err.Error(), "ssh-keyscan") {
		t.Fatalf("error should tell the user how to fix it, got: %v", err)
	}
}

func TestSSHTunnelBadCredentialsDoNotConnect(t *testing.T) {
	e := allEngines()[0]
	a := appForTest(t)
	requireEngine(t, a, e)

	b := startBastion(t)
	sshCfg := b.sshConfig(t)
	sshCfg.Password = "wrong"

	connID := tunnelledConn(t, a, e, sshCfg)
	if err := a.Connect(connID); err == nil {
		a.Disconnect(connID)
		t.Fatal("expected bad bastion credentials to fail the connection")
	}
	if a.IsConnected(connID) {
		t.Fatal("a failed tunnel must not leave the connection registered")
	}
}
