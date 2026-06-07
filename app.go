package main

import (
	"context"
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"xensql/internal/database"
	_ "xensql/internal/database/mysql"
	_ "xensql/internal/database/postgres"
	_ "xensql/internal/database/sqlite"
	"xensql/internal/paths"
	"xensql/internal/service"
	"xensql/internal/storage"
)

type App struct {
	ctx          context.Context
	pool         *database.Pool
	queries      *database.QueryRegistry
	txns         *database.TxnManager
	store        *storage.Store
	history      *storage.HistoryStore
	savedQueries *storage.SavedQueriesStore
	session      *storage.SessionStore
	settings     *storage.SettingsStore

	pendingMu   sync.Mutex
	pendingFile string
}

func NewApp() *App {
	return &App{
		pool:    database.NewPool(),
		queries: database.NewQueryRegistry(),
		txns:    database.NewTxnManager(),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	configDir, err := paths.EnsureDataDir()
	if err != nil {
		runtime.LogErrorf(ctx, "data dir: %v", err)
		configDir = paths.DataDir()
	}
	a.store, err = storage.NewStore(configDir)
	if err != nil {
		runtime.LogErrorf(ctx, "store init: %v", err)
	}
	if a.history, err = storage.NewHistoryStore(configDir); err != nil {
		runtime.LogErrorf(ctx, "history store: %v", err)
	}
	if a.savedQueries, err = storage.NewSavedQueriesStore(configDir); err != nil {
		runtime.LogErrorf(ctx, "saved queries store: %v", err)
	}
	if a.session, err = storage.NewSessionStore(configDir); err != nil {
		runtime.LogErrorf(ctx, "session store: %v", err)
	}
	if a.settings, err = storage.NewSettingsStore(configDir); err != nil {
		runtime.LogErrorf(ctx, "settings store: %v", err)
	}
}

func (a *App) requireStore() (*storage.Store, error) {
	if a.store == nil {
		return nil, fmt.Errorf("data store unavailable")
	}
	return a.store, nil
}

func (a *App) shutdown(ctx context.Context) {
	// Cancel in-flight queries so goroutines unwind before sessions close.
	if a.queries != nil {
		a.queries.CancelAll()
	}
	if a.txns != nil {
		a.txns.RollbackAll()
	}
	a.pool.CloseAll()
}

func (a *App) GetDataDir() string {
	return paths.DataDir()
}

func (a *App) SupportedDrivers() []string {
	types := database.SupportedDrivers()
	out := make([]string, len(types))
	for i, t := range types {
		out[i] = string(t)
	}
	return out
}

func (a *App) FormatSQL(sql string) string {
	return service.FormatSQL(sql)
}

func (a *App) ExportResult(result database.QueryResult, format string) (string, error) {
	return service.ExportResult(&result, format)
}

func (a *App) CopyToClipboard(text string) {
	runtime.ClipboardSetText(a.ctx, text)
}

func errNotFound(what string) error {
	return &notFoundError{what: what}
}

type notFoundError struct{ what string }

func (e *notFoundError) Error() string { return e.what + " not found" }

type AppInfo struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Author      string `json:"author"`
	Email       string `json:"email"`
	Repository  string `json:"repository"`
	Description string `json:"description"`
}

func (a *App) GetAppInfo() AppInfo {
	return AppInfo{
		Name:        "XenSQL",
		Version:     "1.1.1",
		Author:      "Bare7a",
		Email:       "bare7a@gmail.com",
		Repository:  "https://github.com/Bare7a/XenSQL",
		Description: "A fast, native SQL client built with Go and Wails.",
	}
}
