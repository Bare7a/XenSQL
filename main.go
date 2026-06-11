package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"xensql/internal/app"
	"xensql/internal/paths"
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
	if _, err := paths.EnsureDataDir(); err != nil {
		println("Warning: data directory:", err.Error())
	}

	if f := app.FindSQLiteArg(os.Args[1:]); f != "" {
		svc.SetPendingFile(f)
	}

	// Declared before application.New so the single-instance callback (registered in
	// Options) can restore/focus the window once it has been created below.
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

	window = wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "XenSQL",
		Width:            1400,
		Height:           900,
		MinWidth:         800,
		MinHeight:        600,
		Frameless:        true,
		EnableFileDrop:   true,
		BackgroundColour: application.NewRGB(15, 17, 23),
		URL:              "/",
		StartState:       application.WindowStateMaximised,
	})

	// The webview can't see OS file paths (browser security), so the drop is handled
	// here and the paths are relayed to the frontend, which filters for SQLite files.
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(e *application.WindowEvent) {
		wailsApp.Event.Emit("files-dropped", e.Context().DroppedFiles())
	})

	if err := wailsApp.Run(); err != nil {
		println("Error:", err.Error())
	}
}
