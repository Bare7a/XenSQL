package main

import (
	"embed"
	"os"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"xensql/internal/app"
	"xensql/internal/paths"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	application := app.NewApp()
	if _, err := paths.EnsureDataDir(); err != nil {
		println("Warning: data directory:", err.Error())
	}

	if f := app.FindSQLiteArg(os.Args[1:]); f != "" {
		application.SetPendingFile(f)
	}

	appOpts := &options.App{
		Title:     "XenSQL",
		Width:     1400,
		Height:    900,
		MinWidth:  1024,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Frameless: true,
		DragAndDrop: &options.DragAndDrop{
			// DisableWebViewDrop=true kills in-page drag-drop on macOS; keep false and let JS preventDefault handle file-URL navigation.
			EnableFileDrop: true,
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "xensql-b7a-single-instance-lock",
			OnSecondInstanceLaunch: func(data options.SecondInstanceData) {
				if f := app.FindSQLiteArg(data.Args); f != "" {
					application.EmitOpenSQLite(f)
				}
			},
		},
		BackgroundColour: &options.RGBA{R: 15, G: 17, B: 23, A: 1},
		OnStartup:        application.Startup,
		OnShutdown:       application.Shutdown,
		Bind: []interface{}{
			application,
		},
	}
	if runtime.GOOS == "windows" {
		// Dark theme for WebView2's native scrollbars/menus. Its user data stays at
		// the %APPDATA% default - only disposable cache now that prefs are portable.
		appOpts.Windows = &windows.Options{Theme: windows.Dark}
	}

	err := wails.Run(appOpts)

	if err != nil {
		println("Error:", err.Error())
	}
}
