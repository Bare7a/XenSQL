package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"xensql/internal/app"
	"xensql/internal/paths"
	"xensql/internal/windowstate"
)

//go:embed all:frontend/dist
var assets embed.FS

// singleInstanceKey encrypts the IPC payload the OS hands a second instance back
// to the first. It only needs to be stable across builds of this app, not secret.
var singleInstanceKey = [32]byte{
	0x78, 0x65, 0x6e, 0x73, 0x71, 0x6c, 0x2d, 0x62,
	0x37, 0x61, 0x2d, 0x73, 0x69, 0x6e, 0x67, 0x6c,
	0x65, 0x2d, 0x69, 0x6e, 0x73, 0x74, 0x61, 0x6e,
	0x63, 0x65, 0x2d, 0x6b, 0x65, 0x79, 0x21, 0x00,
}

func main() {
	svc := app.NewApp()
	configDir, err := paths.EnsureDataDir()
	if err != nil {
		println("Warning: data directory:", err.Error())
	}

	// Open all stores up front, before the window, so saved settings are ready at creation time.
	svc.InitStores(configDir)
	settings := svc.SettingsStore()

	if f := app.FindSQLiteArg(os.Args[1:]); f != "" {
		svc.SetPendingFile(f)
	}

	var window *application.WebviewWindow

	wailsApp := application.New(application.Options{
		Name:        "XenSQL",
		Description: "A fast, native SQL client built with Go and Wails.",
		Services: []application.Service{
			application.NewService(svc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:      "xensql-b7a-single-instance-lock",
			EncryptionKey: singleInstanceKey,
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if f := app.FindSQLiteArg(data.Args); f != "" {
					svc.EmitOpenSQLite(f)
				}
				if window != nil {
					window.Restore()
					window.Focus()
				}
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	opts := application.WebviewWindowOptions{
		Title:          "XenSQL",
		MinWidth:       800,
		MinHeight:      600,
		Frameless:      true,
		EnableFileDrop: true,
		URL:            "/",
		BackgroundType: application.BackgroundTypeTranslucent,
	}

	// Restore size/position/state from the last session, or the default on first run.
	var saved windowstate.State
	restorable := false
	if settings != nil {
		saved, restorable = windowstate.Load(settings)
	}
	windowstate.Apply(&opts, saved, restorable, wailsApp.Screen.GetPrimary(), opts.MinWidth, opts.MinHeight)

	window = wailsApp.Window.NewWithOptions(opts)

	// Track geometry changes; the returned flush captures the final state on shutdown.
	if settings != nil {
		svc.SetWindowStateFlush(windowstate.Track(window, settings))
	}

	window.OnWindowEvent(events.Common.WindowFilesDropped, func(e *application.WindowEvent) {
		wailsApp.Event.Emit("files-dropped", e.Context().DroppedFiles())
	})

	if err := wailsApp.Run(); err != nil {
		println("Error:", err.Error())
	}
}
