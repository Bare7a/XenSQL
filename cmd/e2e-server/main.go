// Command e2e-server runs XenSQL in Wails v3 server mode: the full Go backend and
// its bindings served over HTTP/WebSocket, with no native window. This is what the
// Playwright E2E suite drives - a real browser talks to the real app.
//
// Built with the "server" tag:
//
//	go run -tags server ./cmd/e2e-server
//
// Config via environment (all optional):
//
//	WAILS_SERVER_HOST   bind address          (default 127.0.0.1)
//	WAILS_SERVER_PORT   listen port           (default 8080)
//	XENSQL_DATA_DIR     data/settings dir     (default ./XenSQL-data)
package main

import (
	"embed"
	"log/slog"
	"os"
	"strconv"

	"github.com/wailsapp/wails/v3/pkg/application"

	"xensql/internal/app"
	"xensql/internal/paths"
)

// The launcher builds the frontend and copies frontend/dist here before this binary
// is compiled, so the same assets the desktop app embeds are served in server mode.
//
//go:embed all:dist
var assets embed.FS

const (
	defaultServerHost = "127.0.0.1"
	defaultServerPort = 8080
)

func serverHost() string {
	if h := os.Getenv("WAILS_SERVER_HOST"); h != "" {
		return h
	}
	return defaultServerHost
}

func serverPort() int {
	if p := os.Getenv("WAILS_SERVER_PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil {
			return n
		}
		println("Warning: invalid WAILS_SERVER_PORT, using default:", p)
	}
	return defaultServerPort
}

func main() {
	svc := app.NewApp()

	configDir, err := paths.EnsureDataDir()
	if err != nil {
		println("Warning: data directory:", err.Error())
	}
	svc.InitStores(configDir)

	if f := app.FindSQLiteArg(os.Args[1:]); f != "" {
		svc.SetPendingFile(f)
	}

	// No window is created: in server mode the connected browser is the client.
	// Wails serves a /health endpoint automatically, which Playwright uses to wait
	// for readiness.
	wailsApp := application.New(application.Options{
		Name:        "XenSQL",
		Description: "A fast, native SQL client built with Go and Wails.",
		// Quiet the Wails system logger: drop the per-asset-request / WebSocket INFO
		// chatter from the Playwright test output, keeping warnings and errors.
		LogLevel: slog.LevelWarn,
		Server: application.ServerOptions{
			Host: serverHost(),
			Port: serverPort(),
		},
		Services: []application.Service{
			application.NewService(svc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
	})

	if err := wailsApp.Run(); err != nil {
		println("Error:", err.Error())
		os.Exit(1)
	}
}
