//go:build !darwin && !windows

package windowtheme

import "github.com/wailsapp/wails/v3/pkg/application"

// Frameless window: only the pre-paint background can follow the app theme.
func configureOS(opts *application.WebviewWindowOptions, p colours, _ bool) {
	opts.BackgroundColour = p.base
}

func applyOS(window *application.WebviewWindow, p colours, _ bool) {
	window.SetBackgroundColour(p.base)
}
