package sshtunnel

import (
	"context"
	"crypto/ed25519"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// directTCPIP is the payload of a direct-tcpip channel open request (RFC 4254 s7.2).
type directTCPIP struct {
	DestHost string
	DestPort uint32
	SrcHost  string
	SrcPort  uint32
}

type serverAuth struct {
	password  string
	publicKey ssh.PublicKey
}

// startBastion runs an in-process SSH server forwarding direct-tcpip, the same path a real bastion
// takes.
func startBastion(t *testing.T, auth serverAuth) (addr string, hostKey ssh.PublicKey) {
	t.Helper()

	_, hostPriv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate host key: %v", err)
	}
	hostSigner, err := ssh.NewSignerFromKey(hostPriv)
	if err != nil {
		t.Fatalf("host signer: %v", err)
	}

	srvCfg := &ssh.ServerConfig{}
	if auth.password != "" {
		srvCfg.PasswordCallback = func(_ ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if string(pass) != auth.password {
				return nil, errors.New("bad password")
			}
			return nil, nil
		}
	}
	if auth.publicKey != nil {
		srvCfg.PublicKeyCallback = func(_ ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if !bytesEqual(key.Marshal(), auth.publicKey.Marshal()) {
				return nil, errors.New("unknown key")
			}
			return nil, nil
		}
	}
	srvCfg.AddHostKey(hostSigner)

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
			go serveBastionConn(conn, srvCfg)
		}
	}()

	return ln.Addr().String(), hostSigner.PublicKey()
}

func serveBastionConn(conn net.Conn, cfg *ssh.ServerConfig) {
	sshConn, chans, reqs, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		_ = conn.Close()
		return
	}
	defer sshConn.Close()
	go ssh.DiscardRequests(reqs) // keepalives
	for newCh := range chans {
		if newCh.ChannelType() != "direct-tcpip" {
			_ = newCh.Reject(ssh.UnknownChannelType, "only direct-tcpip")
			continue
		}
		var payload directTCPIP
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

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// startEchoServer stands in for the database.
func startEchoServer(t *testing.T) string {
	t.Helper()
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
			go func() {
				defer conn.Close()
				_, _ = io.Copy(conn, conn)
			}()
		}
	}()
	return ln.Addr().String()
}

func writeKnownHosts(t *testing.T, addr string, key ssh.PublicKey) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "known_hosts")
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split addr: %v", err)
	}
	// Non-standard ports are recorded as [host]:port.
	entry := fmt.Sprintf("[%s]:%s %s\n", host, port, string(ssh.MarshalAuthorizedKey(key)))
	if err := os.WriteFile(path, []byte(entry), 0o600); err != nil {
		t.Fatalf("write known_hosts: %v", err)
	}
	return path
}

func splitAddr(t *testing.T, addr string) (string, int) {
	t.Helper()
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split addr: %v", err)
	}
	var port int
	if _, err := fmt.Sscanf(portStr, "%d", &port); err != nil {
		t.Fatalf("parse port: %v", err)
	}
	return host, port
}

func TestTunnelForwardsToTarget(t *testing.T) {
	bastion, hostKey := startBastion(t, serverAuth{password: "hunter2"})
	echo := startEchoServer(t)
	host, port := splitAddr(t, bastion)

	tunnel, err := Open(context.Background(), Config{
		Host:       host,
		Port:       port,
		User:       "dev",
		Auth:       AuthPassword,
		Password:   "hunter2",
		KnownHosts: writeKnownHosts(t, bastion, hostKey),
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer tunnel.Close()

	conn, err := tunnel.DialContext(context.Background(), "tcp", echo)
	if err != nil {
		t.Fatalf("DialContext: %v", err)
	}
	defer conn.Close()

	if _, err := conn.Write([]byte("SELECT 1")); err != nil {
		t.Fatalf("write: %v", err)
	}
	buf := make([]byte, 8)
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set deadline: %v", err)
	}
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(buf) != "SELECT 1" {
		t.Fatalf("got %q through the tunnel, want %q", buf, "SELECT 1")
	}
}

// A raw SSH channel rejects SetDeadline, which would fail the drivers' queries.
func TestConnAcceptsDeadlinesTheDriversSet(t *testing.T) {
	bastion, hostKey := startBastion(t, serverAuth{password: "pw"})
	echo := startEchoServer(t)
	host, port := splitAddr(t, bastion)

	tunnel, err := Open(context.Background(), Config{
		Host: host, Port: port, User: "dev",
		Auth: AuthPassword, Password: "pw",
		KnownHosts: writeKnownHosts(t, bastion, hostKey),
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer tunnel.Close()

	conn, err := tunnel.DialContext(context.Background(), "tcp", echo)
	if err != nil {
		t.Fatalf("DialContext: %v", err)
	}
	defer conn.Close()

	if err := conn.SetDeadline(time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("future deadline rejected: %v", err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("future read deadline rejected: %v", err)
	}
	if err := conn.SetWriteDeadline(time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("future write deadline rejected: %v", err)
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		t.Fatalf("clearing the deadline failed: %v", err)
	}
	if _, err := conn.Write([]byte("ok")); err != nil {
		t.Fatalf("connection unusable after setting deadlines: %v", err)
	}

	// An elapsed deadline is the drivers' abort signal.
	if err := conn.SetDeadline(time.Now().Add(-time.Second)); err != nil {
		t.Fatalf("abort deadline: %v", err)
	}
	if _, err := conn.Write([]byte("gone")); err == nil {
		t.Fatal("expected the connection to be closed by the elapsed deadline")
	}
}

func TestTunnelDialErrorNamesTheTarget(t *testing.T) {
	bastion, hostKey := startBastion(t, serverAuth{password: "pw"})
	host, port := splitAddr(t, bastion)

	tunnel, err := Open(context.Background(), Config{
		Host: host, Port: port, User: "dev",
		Auth: AuthPassword, Password: "pw",
		KnownHosts: writeKnownHosts(t, bastion, hostKey),
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer tunnel.Close()

	// Port 1 refuses; the error must name the hop that failed.
	_, err = tunnel.DialContext(context.Background(), "tcp", "127.0.0.1:1")
	if err == nil {
		t.Fatal("expected a dial error")
	}
	if !strings.Contains(err.Error(), "from the bastion") {
		t.Fatalf("error does not identify the failing hop: %v", err)
	}
}

func TestPublicKeyAuth(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	sshPub, err := ssh.NewPublicKey(pub)
	if err != nil {
		t.Fatalf("public key: %v", err)
	}
	block, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	keyPath := filepath.Join(t.TempDir(), "id_ed25519")
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}

	bastion, hostKey := startBastion(t, serverAuth{publicKey: sshPub})
	host, port := splitAddr(t, bastion)

	tunnel, err := Open(context.Background(), Config{
		Host: host, Port: port, User: "dev",
		Auth: AuthKey, KeyPath: keyPath,
		KnownHosts: writeKnownHosts(t, bastion, hostKey),
	})
	if err != nil {
		t.Fatalf("Open with key auth: %v", err)
	}
	_ = tunnel.Close()
}

func TestEncryptedKeyRequiresPassphrase(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	block, err := ssh.MarshalPrivateKeyWithPassphrase(priv, "", []byte("s3cret"))
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	encrypted := pem.EncodeToMemory(block)

	if _, err := parsePrivateKey(encrypted, ""); err == nil {
		t.Fatal("expected an error for an encrypted key with no passphrase")
	} else if !strings.Contains(err.Error(), "passphrase") {
		t.Fatalf("error should mention the passphrase, got: %v", err)
	}

	if _, err := parsePrivateKey(encrypted, "wrong"); err == nil {
		t.Fatal("expected an error for the wrong passphrase")
	}

	if _, err := parsePrivateKey(encrypted, "s3cret"); err != nil {
		t.Fatalf("correct passphrase should parse: %v", err)
	}
}

func TestUnknownHostKeyIsRejectedWithGuidance(t *testing.T) {
	bastion, _ := startBastion(t, serverAuth{password: "pw"})
	host, port := splitAddr(t, bastion)

	// known_hosts exists but has no entry for this bastion.
	empty := filepath.Join(t.TempDir(), "known_hosts")
	if err := os.WriteFile(empty, []byte(""), 0o600); err != nil {
		t.Fatalf("write known_hosts: %v", err)
	}

	_, err := Open(context.Background(), Config{
		Host: host, Port: port, User: "dev",
		Auth: AuthPassword, Password: "pw",
		KnownHosts: empty,
	})
	if err == nil {
		t.Fatal("expected the unknown host key to be rejected")
	}
	if !strings.Contains(err.Error(), "ssh-keyscan") {
		t.Fatalf("error should tell the user how to fix it, got: %v", err)
	}
}

func TestMismatchedHostKeyIsRejected(t *testing.T) {
	bastion, _ := startBastion(t, serverAuth{password: "pw"})
	other, otherKey := startBastion(t, serverAuth{password: "pw"})
	_ = other
	host, port := splitAddr(t, bastion)

	// Record a different server's key against this bastion's address.
	wrong := writeKnownHosts(t, bastion, otherKey)

	_, err := Open(context.Background(), Config{
		Host: host, Port: port, User: "dev",
		Auth: AuthPassword, Password: "pw",
		KnownHosts: wrong,
	})
	if err == nil {
		t.Fatal("expected a host key mismatch to be rejected")
	}
	if !strings.Contains(err.Error(), "does not match known_hosts") {
		t.Fatalf("error should flag the mismatch, got: %v", err)
	}
}

func TestIgnoreHostKeySkipsVerification(t *testing.T) {
	bastion, _ := startBastion(t, serverAuth{password: "pw"})
	host, port := splitAddr(t, bastion)

	tunnel, err := Open(context.Background(), Config{
		Host: host, Port: port, User: "dev",
		Auth: AuthPassword, Password: "pw",
		IgnoreHostKey: true,
	})
	if err != nil {
		t.Fatalf("Open with IgnoreHostKey: %v", err)
	}
	_ = tunnel.Close()
}

func TestBadCredentialsAreReported(t *testing.T) {
	bastion, hostKey := startBastion(t, serverAuth{password: "right"})
	host, port := splitAddr(t, bastion)

	_, err := Open(context.Background(), Config{
		Host: host, Port: port, User: "dev",
		Auth: AuthPassword, Password: "wrong",
		KnownHosts: writeKnownHosts(t, bastion, hostKey),
	})
	if err == nil {
		t.Fatal("expected authentication to fail")
	}
	if !strings.Contains(err.Error(), "rejected the credentials") {
		t.Fatalf("error should name the cause, got: %v", err)
	}
}

func TestClientConfigValidation(t *testing.T) {
	tests := []struct {
		name string
		cfg  Config
		want string
	}{
		{"no host", Config{User: "dev", IgnoreHostKey: true}, "bastion host is required"},
		{"no user", Config{Host: "h", IgnoreHostKey: true}, "bastion username is required"},
		{"no key path", Config{Host: "h", User: "d", Auth: AuthKey, IgnoreHostKey: true}, "private key file is required"},
		{"bad method", Config{Host: "h", User: "d", Auth: "carrier-pigeon", IgnoreHostKey: true}, "unknown authentication method"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := clientConfig(tc.cfg)
			if err == nil {
				t.Fatalf("expected an error containing %q", tc.want)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("got %v, want it to contain %q", err, tc.want)
			}
		})
	}
}

func TestOpenFailsFastOnUnreachableBastion(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// Port 1 on loopback refuses immediately.
	_, err := Open(ctx, Config{
		Host: "127.0.0.1", Port: 1, User: "dev",
		Auth: AuthPassword, Password: "pw", IgnoreHostKey: true,
	})
	if err == nil {
		t.Fatal("expected an error reaching the bastion")
	}
	if !strings.Contains(err.Error(), "cannot reach bastion") {
		t.Fatalf("got %v, want it to name the bastion hop", err)
	}
}

func TestExpandPath(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home directory")
	}
	got, err := ExpandPath("~/.ssh/id_rsa")
	if err != nil {
		t.Fatalf("ExpandPath: %v", err)
	}
	if want := filepath.Join(home, ".ssh", "id_rsa"); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	// Bare paths and embedded tildes pass through untouched.
	for _, p := range []string{"/abs/id_rsa", "relative/id_rsa", "/tmp/we~ird"} {
		got, err := ExpandPath(p)
		if err != nil {
			t.Fatalf("ExpandPath(%q): %v", p, err)
		}
		if got != p {
			t.Fatalf("ExpandPath(%q) = %q, want it unchanged", p, got)
		}
	}
}
