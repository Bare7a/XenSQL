package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"xensql/internal/database"
)

func TestConnectionsDeletePersists(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := s.SaveConnection(database.ConnectionConfig{ID: "c1", Name: "One", Driver: database.DriverSQLite, FilePath: "/tmp/x.db"})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID != "c1" {
		t.Fatalf("id: %s", saved.ID)
	}
	ok, err := s.DeleteConnection("c1")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected delete ok")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"id": "c1"`) || strings.Contains(string(raw), `"name": "One"`) {
		t.Fatalf("connection should be removed from file: %s", raw)
	}
	s2, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(s2.ListConnections()) != 0 {
		t.Fatal("expected no connections after reload")
	}
}
