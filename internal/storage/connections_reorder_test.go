package storage

import (
	"path/filepath"
	"testing"

	"xensql/internal/database"
)

func TestReorderConnections(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	s.connections = []database.ConnectionConfig{
		{ID: "a", Name: "A"},
		{ID: "b", Name: "B"},
		{ID: "c", Name: "C"},
	}
	if err := s.ReorderConnections([]string{"c", "a", "b"}); err != nil {
		t.Fatal(err)
	}
	got := s.ListConnections()
	if len(got) != 3 || got[0].ID != "c" || got[1].ID != "a" || got[2].ID != "b" {
		t.Fatalf("order: %+v", got)
	}
	s2, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got2 := s2.ListConnections()
	if len(got2) != 3 || got2[0].ID != "c" {
		t.Fatalf("persisted order: %+v", got2)
	}
	_ = filepath.Join(dir, "connections.json")
}
