// Package windowtheme colours the window chrome to the app theme; the palette
// mirrors --bg-base/--bg-panel/--border from tokens.css.
package windowtheme

import "github.com/wailsapp/wails/v3/pkg/application"

// Written by frontend/src/shared/lib/theme.ts on every theme change.
const settingsKey = "xensql-theme"

type colours struct {
	base   application.RGBA
	panel  application.RGBA
	border application.RGBA
}

var palettes = map[string]colours{
	"dark": {
		base:   rgb(0x0f1117),
		panel:  rgb(0x161b22),
		border: rgb(0x30363d),
	},
	"light": {
		base:   rgb(0xffffff),
		panel:  rgb(0xf6f8fa),
		border: rgb(0xd0d7de),
	},
}

func rgb(hex uint32) application.RGBA {
	return application.RGBA{Red: uint8(hex >> 16), Green: uint8(hex >> 8), Blue: uint8(hex), Alpha: 255}
}

// Load returns the persisted app theme, defaulting to dark.
func Load(prefs map[string]string) string {
	if prefs[settingsKey] == "light" {
		return "light"
	}
	return "dark"
}

// Configure sets the creation-time window options for the theme's colours.
func Configure(opts *application.WebviewWindowOptions, theme string) {
	configureOS(opts, palettes[theme], theme == "dark")
}

// Update recolours a live window when the theme setting changes; other keys are ignored.
func Update(window *application.WebviewWindow, key, value string) {
	if key != settingsKey {
		return
	}
	p, ok := palettes[value]
	if !ok {
		return
	}
	applyOS(window, p, value == "dark")
}
