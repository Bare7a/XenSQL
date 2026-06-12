package app

import (
	"context"
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

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
	app          *application.App
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

func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.ctx = ctx
	a.app = application.Get()
	configDir, err := paths.EnsureDataDir()
	if err != nil {
		a.logErrorf("data dir: %v", err)
		configDir = paths.DataDir()
	}
	a.store, err = storage.NewStore(configDir)
	if err != nil {
		a.logErrorf("store init: %v", err)
	}
	if a.history, err = storage.NewHistoryStore(configDir); err != nil {
		a.logErrorf("history store: %v", err)
	}
	if a.savedQueries, err = storage.NewSavedQueriesStore(configDir); err != nil {
		a.logErrorf("saved queries store: %v", err)
	}
	if a.session, err = storage.NewSessionStore(configDir); err != nil {
		a.logErrorf("session store: %v", err)
	}
	if a.settings, err = storage.NewSettingsStore(configDir); err != nil {
		a.logErrorf("settings store: %v", err)
	}
	return nil
}

func (a *App) emit(name string, data any) {
	if a.app == nil {
		return
	}
	event := &application.CustomEvent{Name: name, Data: data}
	for _, w := range a.app.Window.GetAll() {
		w.DispatchWailsEvent(event)
	}
}

func (a *App) logErrorf(format string, args ...any) {
	if a.app != nil {
		a.app.Logger.Error(fmt.Sprintf(format, args...))
	}
}

func (a *App) requireStore() (*storage.Store, error) {
	if a.store == nil {
		return nil, fmt.Errorf("data store unavailable")
	}
	return a.store, nil
}

func (a *App) ServiceShutdown() error {
	// Cancel in-flight queries so goroutines unwind before sessions close.
	if a.queries != nil {
		a.queries.CancelAll()
	}
	if a.txns != nil {
		a.txns.RollbackAll()
	}
	a.pool.CloseAll()
	return nil
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
	if a.app != nil {
		a.app.Clipboard.SetText(text)
	}
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
		Version:     "1.1.2",
		Author:      "Bare7a",
		Email:       "bare7a@gmail.com",
		Repository:  "https://github.com/Bare7a/XenSQL",
		Description: "A fast, native SQL client built with Go and Wails.",
	}
}
