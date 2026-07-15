package windowtheme

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

// Frameless window: only the pre-paint background, immersive mode and Win11
// border are themed.
func configureOS(opts *application.WebviewWindowOptions, p colours, dark bool) {
	opts.BackgroundColour = p.base
	opts.Windows.Theme = application.Light
	if dark {
		opts.Windows.Theme = application.Dark
	}
}

func applyOS(window *application.WebviewWindow, p colours, dark bool) {
	window.SetBackgroundColour(p.base)
	handle := window.NativeWindow()
	if handle == nil {
		return
	}
	hwnd := uintptr(handle)
	application.InvokeSync(func() {
		w32.SetTheme(hwnd, dark)
		if w32.SupportsCustomThemes() {
			w32.SetBorderColour(hwnd, colorref(p.border))
		}
	})
}

// colorref packs an RGBA into a Win32 COLORREF (0x00BBGGRR).
func colorref(c application.RGBA) uint32 {
	return uint32(c.Blue)<<16 | uint32(c.Green)<<8 | uint32(c.Red)
}
