package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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

func (a *App) EmitOpenSQLite(filePath string) {
	if filePath == "" {
		return
	}
	name := filepath.Base(filePath)
	ext := filepath.Ext(name)
	if ext != "" {
		name = name[:len(name)-len(ext)]
	}
	runtime.EventsEmit(a.ctx, "open-sqlite", map[string]string{
		"filePath": filePath,
		"name":     name,
	})
}

func (a *App) GetPendingFile() map[string]string {
	a.pendingMu.Lock()
	path := a.pendingFile
	a.pendingFile = ""
	a.pendingMu.Unlock()
	if path == "" {
		return nil
	}
	name := filepath.Base(path)
	ext := filepath.Ext(name)
	if ext != "" {
		name = name[:len(name)-len(ext)]
	}
	return map[string]string{"filePath": path, "name": name}
}

func (a *App) SetPendingFile(path string) {
	a.pendingMu.Lock()
	a.pendingFile = path
	a.pendingMu.Unlock()
}

func (a *App) PickSQLiteFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select SQLite database",
		Filters: []runtime.FileFilter{
			{DisplayName: "SQLite Database", Pattern: "*.db;*.sqlite;*.sqlite3"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
}

func (a *App) PickExportSavePath(ext string) (string, error) {
	if ext == "" {
		ext = "txt"
	}
	pattern := "*." + ext
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save export",
		DefaultFilename: "export." + ext,
		Filters: []runtime.FileFilter{
			{DisplayName: strings.ToUpper(ext) + " files", Pattern: pattern},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	})
}

func (a *App) SaveTextFile(path, content string) error {
	if path == "" {
		return fmt.Errorf("path is empty")
	}
	return os.WriteFile(path, []byte(content), 0o600)
}
