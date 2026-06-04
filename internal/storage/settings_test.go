package storage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSettingsSetPersistsAndReloads(t *testing.T) {
	dir := t.TempDir()
	s, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Set("xensql-theme", "light"); err != nil {
		t.Fatal(err)
	}
	if err := s.Set("xensql-language", "de"); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if body := string(raw); !strings.Contains(body, "xensql-theme") || !strings.Contains(body, "light") {
		t.Fatalf("unexpected settings file: %s", body)
	}

	s2, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := s2.GetAll()
	if got["xensql-theme"] != "light" || got["xensql-language"] != "de" {
		t.Fatalf("reload mismatch: %+v", got)
	}
}

func TestSettingsGetAllReturnsCopy(t *testing.T) {
	dir := t.TempDir()
	s, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Set("k", "v"); err != nil {
		t.Fatal(err)
	}
	got := s.GetAll()
	got["k"] = "mutated"
	if s.GetAll()["k"] != "v" {
		t.Fatal("GetAll must return a copy; internal map was mutated")
	}
}

func TestSettingsDelete(t *testing.T) {
	dir := t.TempDir()
	s, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Set("k", "v"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete("k"); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.GetAll()["k"]; ok {
		t.Fatal("key should be gone after Delete")
	}
	// Deleting a missing key is a no-op, not an error.
	if err := s.Delete("missing"); err != nil {
		t.Fatalf("Delete(missing) = %v, want nil", err)
	}
}

func TestSettingsRecoversFromCorruptFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte("{not valid json"), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := NewSettingsStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.GetAll()) != 0 {
		t.Fatal("corrupt file should reset to an empty store")
	}
	matches, _ := filepath.Glob(path + ".corrupt-*")
	if len(matches) == 0 {
		t.Fatal("expected a .corrupt-* backup of the unparseable file")
	}
}
