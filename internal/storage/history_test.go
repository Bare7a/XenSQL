package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"xensql/internal/database"
)

func TestHistoryClearPersistsPerConnection(t *testing.T) {
	dir := t.TempDir()
	h, err := NewHistoryStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.Add(database.HistoryEntry{ConnectionID: "c1", SQL: "SELECT 1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Add(database.HistoryEntry{ConnectionID: "c2", SQL: "SELECT 2"}); err != nil {
		t.Fatal(err)
	}
	if err := h.Clear("c1"); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(dir, "query_history.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	if strings.Contains(body, `"connectionId": "c1"`) || strings.Contains(body, "SELECT 1") {
		t.Fatalf("file should not contain c1 entries: %s", body)
	}
	if !strings.Contains(body, `"connectionId": "c2"`) {
		t.Fatalf("file should still contain c2: %s", body)
	}

	h2, err := NewHistoryStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(h2.List("c1", 100)) != 0 {
		t.Fatal("c1 list should be empty after reload")
	}
	if len(h2.List("c2", 100)) != 1 {
		t.Fatal("c2 list should have one entry after reload")
	}
}

func TestHistoryClearAllWritesEmptyArray(t *testing.T) {
	dir := t.TempDir()
	h, err := NewHistoryStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.Add(database.HistoryEntry{ConnectionID: "c1", SQL: "SELECT 1"}); err != nil {
		t.Fatal(err)
	}
	if err := h.Clear(""); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "query_history.json"))
	if err != nil {
		t.Fatal(err)
	}
	body := strings.TrimSpace(string(raw))
	if body != "[]" {
		t.Fatalf("expected empty JSON array, got: %s", body)
	}
}
