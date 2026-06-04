package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"xensql/internal/database"
)

func TestSavedQueriesSaveDeletePersist(t *testing.T) {
	dir := t.TempDir()
	s, err := NewSavedQueriesStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := s.Save(database.SavedQuery{
		Name:         "My query",
		ConnectionID: "c1",
		SQL:          "SELECT 1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" {
		t.Fatal("expected generated id")
	}

	path := filepath.Join(dir, "saved_queries.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "My query") {
		t.Fatalf("expected query in file: %s", raw)
	}

	ok, err := s.Delete(saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected delete true")
	}
	raw, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "My query") {
		t.Fatalf("file should not contain deleted query: %s", raw)
	}

	s2, err := NewSavedQueriesStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(s2.List("")) != 0 {
		t.Fatal("expected empty list after reload")
	}
}

func TestSavedQueriesEmptyFileIsArray(t *testing.T) {
	dir := t.TempDir()
	s, err := NewSavedQueriesStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	ok, err := s.Delete("missing")
	if err != nil || ok {
		t.Fatalf("delete missing: ok=%v err=%v", ok, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "saved_queries.json"), []byte("[]"), 0o600); err != nil {
		t.Fatal(err)
	}
	s2, err := NewSavedQueriesStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(s2.List("")) != 0 {
		t.Fatal("expected empty queries slice")
	}
}
