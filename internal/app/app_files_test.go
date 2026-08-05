package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAppendTextFileStreamsChunksInOrder(t *testing.T) {
	a := &App{}
	path := filepath.Join(t.TempDir(), "export.csv")

	if err := a.AppendTextFile(path, "a,b\n", true); err != nil {
		t.Fatalf("first chunk: %v", err)
	}
	if err := a.AppendTextFile(path, "1,2\n", false); err != nil {
		t.Fatalf("second chunk: %v", err)
	}
	if err := a.AppendTextFile(path, "3,4", false); err != nil {
		t.Fatalf("third chunk: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if want := "a,b\n1,2\n3,4"; string(got) != want {
		t.Errorf("got %q, want %q", string(got), want)
	}
}

// A second export to the same path must replace the file, not append to the previous one.
func TestAppendTextFileTruncatesExistingContents(t *testing.T) {
	a := &App{}
	path := filepath.Join(t.TempDir(), "export.csv")
	if err := os.WriteFile(path, []byte("a much longer previous export"), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := a.AppendTextFile(path, "fresh", true); err != nil {
		t.Fatalf("truncating write: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != "fresh" {
		t.Errorf("got %q, want %q", string(got), "fresh")
	}
}

func TestAppendTextFileCreatesWithOwnerOnlyPermissions(t *testing.T) {
	a := &App{}
	path := filepath.Join(t.TempDir(), "export.csv")
	if err := a.AppendTextFile(path, "x", true); err != nil {
		t.Fatalf("write: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	// Matches SaveTextFile: an export can hold query results.
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("mode = %v, want 0600", perm)
	}
}

func TestAppendTextFileRejectsEmptyPath(t *testing.T) {
	a := &App{}
	if err := a.AppendTextFile("", "x", true); err == nil {
		t.Error("an empty path should fail")
	}
}
