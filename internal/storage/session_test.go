package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSessionSavePersistsTabs(t *testing.T) {
	dir := t.TempDir()
	s, err := NewSessionStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	session := EditorSession{
		Tabs: []EditorTab{{
			ID:           "t1",
			ConnectionID: "c1",
			Title:        "Query 1",
			SQL:          "SELECT 1",
			Color:        "#3b82f6",
		}},
		ActiveTab: "t1",
	}
	if err := s.Save(session); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "editor_session.json"))
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	if !strings.Contains(body, "Query 1") || !strings.Contains(body, "t1") {
		t.Fatalf("unexpected session file: %s", body)
	}

	s2, err := NewSessionStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := s2.Get()
	if len(got.Tabs) != 1 || got.Tabs[0].ID != "t1" || got.ActiveTab != "t1" {
		t.Fatalf("reload mismatch: %+v", got)
	}
}

func TestSessionSavePersistsTableViewTab(t *testing.T) {
	dir := t.TempDir()
	s, err := NewSessionStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	session := EditorSession{
		Tabs: []EditorTab{{
			ID:           "tv1",
			ConnectionID: "c1",
			Title:        "users",
			SQL:          "",
			Color:        "#3b82f6",
			TableView:    &TableViewRef{Schema: "public", Table: "users", Filter: "age > 30", OrderBy: "name", OrderDir: "DESC"},
		}},
		ActiveTab: "tv1",
	}
	if err := s.Save(session); err != nil {
		t.Fatal(err)
	}
	s2, err := NewSessionStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := s2.Get()
	if len(got.Tabs) != 1 {
		t.Fatalf("tabs: %+v", got.Tabs)
	}
	tv := got.Tabs[0].TableView
	if tv == nil || tv.Schema != "public" || tv.Table != "users" {
		t.Fatalf("tableView: %+v", tv)
	}
	if tv.Filter != "age > 30" || tv.OrderBy != "name" || tv.OrderDir != "DESC" {
		t.Fatalf("view state not persisted: %+v", tv)
	}
}

func TestSessionSaveEmptyTabsWritesArray(t *testing.T) {
	dir := t.TempDir()
	s, err := NewSessionStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Save(EditorSession{Tabs: nil, ActiveTab: ""}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "editor_session.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"tabs": []`) {
		t.Fatalf("expected empty tabs array, got: %s", raw)
	}
}
