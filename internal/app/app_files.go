package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var sqliteExts = map[string]bool{
	".db": true, ".sqlite": true, ".sqlite3": true, ".s3db": true, ".sl3": true,
}

func isSQLiteFile(path string) bool {
	return sqliteExts[strings.ToLower(filepath.Ext(path))]
}

func FindSQLiteArg(args []string) string {
	for _, arg := range args {
		if isSQLiteFile(arg) {
			if _, err := os.Stat(arg); err == nil {
				return arg
			}
		}
	}
	return ""
}

// sqliteFilePayload is the {filePath, name} payload of open-sqlite flows; name is the file's base
// name without extension.
func sqliteFilePayload(path string) map[string]string {
	name := filepath.Base(path)
	name = strings.TrimSuffix(name, filepath.Ext(name))
	return map[string]string{"filePath": path, "name": name}
}

func (a *App) EmitOpenSQLite(filePath string) {
	if filePath == "" {
		return
	}
	a.emit("open-sqlite", sqliteFilePayload(filePath))
}

func (a *App) GetPendingFile() map[string]string {
	a.pendingMu.Lock()
	path := a.pendingFile
	a.pendingFile = ""
	a.pendingMu.Unlock()
	if path == "" {
		return nil
	}
	return sqliteFilePayload(path)
}

func (a *App) SetPendingFile(path string) {
	a.pendingMu.Lock()
	a.pendingFile = path
	a.pendingMu.Unlock()
}

func (a *App) PickSQLiteFile() (string, error) {
	return a.app.Dialog.OpenFile().
		SetTitle("Select SQLite database").
		CanChooseFiles(true).
		AddFilter("SQLite Database", "*.db;*.sqlite;*.sqlite3").
		AddFilter("All Files", "*.*").
		PromptForSingleSelection()
}

func (a *App) PickExportSavePath(ext string) (string, error) {
	if ext == "" {
		ext = "txt"
	}
	return a.app.Dialog.SaveFile().
		SetFilename("export."+ext).
		AddFilter(strings.ToUpper(ext)+" files", "*."+ext).
		AddFilter("All Files", "*.*").
		PromptForSingleSelection()
}

func (a *App) SaveTextFile(path, content string) error {
	if path == "" {
		return fmt.Errorf("path is empty")
	}
	return os.WriteFile(path, []byte(content), 0o600)
}
