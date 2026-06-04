package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Write-then-rename so a crash mid-write never leaves a truncated/zero-byte file.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpName) }

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Chmod(tmpName, perm); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		cleanup()
		return err
	}
	// fsync the directory so the rename survives a crash (POSIX); best-effort.
	if dirF, derr := os.Open(dir); derr == nil {
		_ = dirF.Sync()
		_ = dirF.Close()
	}
	return nil
}

// backupCorruptFile renames an unparseable file to a timestamped .corrupt sibling
// so the next write can't silently destroy it. Best-effort.
func backupCorruptFile(path string) {
	_ = os.Rename(path, fmt.Sprintf("%s.corrupt-%d", path, time.Now().UnixNano()))
}
