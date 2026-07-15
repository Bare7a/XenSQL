// Package appmenu builds the native macOS menu bar. Item ids and event payloads
// are shared with frontend/src/features/layout/lib/nativeMenu.ts: clicks emit
// ActionEvent ids, the frontend pushes item state back via SyncEvent.
package appmenu

import (
	"encoding/json"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	ActionEvent = "menu:action"
	SyncEvent   = "menu:sync"
)

// ItemState is one property update for a menu item, pushed by the frontend.
type ItemState struct {
	ID          string `json:"id"`
	Label       string `json:"label,omitempty"`
	Checked     *bool  `json:"checked,omitempty"`
	Enabled     *bool  `json:"enabled,omitempty"`
	Accelerator string `json:"accelerator,omitempty"`
}

// Menu is the built menu bar plus an id index for live property updates.
type Menu struct {
	root  *application.Menu
	items map[string]*application.MenuItem
}

func (m *Menu) Root() *application.Menu { return m.root }

// Build creates the menu once, with English labels and default accelerators the
// frontend re-syncs after boot; structural Menu.Update() calls deadlock on macOS.
func Build(emit func(id string)) *Menu {
	m := &Menu{root: application.NewMenu(), items: map[string]*application.MenuItem{}}

	// The first submenu becomes the macOS app menu; AppKit swaps in the app name.
	app := m.root.AddSubmenu("XenSQL")
	m.item(app, "about", "About XenSQL", "", emit)
	app.AddSeparator()
	app.AddRole(application.ServicesMenu)
	app.AddSeparator()
	app.AddRole(application.Hide)
	app.AddRole(application.HideOthers)
	app.AddRole(application.UnHide)
	app.AddSeparator()
	app.AddRole(application.Quit)

	file := m.root.AddSubmenu("File")
	m.item(file, "newTab", "New Tab", "cmdorctrl+t", emit)
	m.item(file, "closeTab", "Close Tab", "cmdorctrl+w", emit)
	m.item(file, "reopenClosedTab", "Reopen Closed Tab", "cmdorctrl+shift+t", emit)
	file.AddSeparator()
	m.item(file, "quickSearch", "Quick Search", "cmdorctrl+p", emit)

	// Edit and Window roles act on the webview via the responder chain - no wiring.
	m.root.AddRole(application.EditMenu)

	view := m.root.AddSubmenu("View")
	theme := view.AddSubmenu("Theme")
	m.radio(theme, "theme-dark", "Dark", emit)
	m.radio(theme, "theme-light", "Light", emit)
	language := view.AddSubmenu("Language")
	m.radio(language, "lang-en", "English", emit)
	m.radio(language, "lang-de", "Deutsch", emit)
	m.radio(language, "lang-bg", "Български", emit)
	view.AddSeparator()
	m.item(view, "zoomIn", "Zoom In", "cmdorctrl+=", emit)
	m.item(view, "zoomOut", "Zoom Out", "cmdorctrl+-", emit)
	m.item(view, "resetZoom", "Reset Zoom", "cmdorctrl+0", emit)
	view.AddSeparator()
	m.item(view, "increaseEditorFontSize", "Increase Editor Font Size", "cmdorctrl+shift+.", emit)
	m.item(view, "decreaseEditorFontSize", "Decrease Editor Font Size", "cmdorctrl+shift+,", emit)
	m.item(view, "resetEditorFontSize", "Reset Editor Font Size", "", emit)
	view.AddSeparator()
	m.checkbox(view, "toggleSidebar", "Toggle Sidebar", "cmdorctrl+b", emit)
	m.checkbox(view, "toggleJsonPanel", "Toggle JSON Viewer", "cmdorctrl+j", emit)
	view.AddSeparator()
	view.AddRole(application.ToggleFullscreen)

	m.root.AddRole(application.WindowMenu)

	help := m.root.AddSubmenu("Help")
	m.item(help, "tips", "Keyboard Tips", "", emit)
	m.item(help, "shortcuts", "Keyboard Shortcuts", "", emit)
	help.AddSeparator()
	m.item(help, "helpAbout", "About XenSQL", "", emit)

	return m
}

func (m *Menu) item(parent *application.Menu, id, label, accelerator string, emit func(string)) {
	it := parent.Add(label).OnClick(func(*application.Context) { emit(id) })
	if accelerator != "" {
		it.SetAccelerator(accelerator)
	}
	m.items[id] = it
}

func (m *Menu) radio(parent *application.Menu, id, label string, emit func(string)) {
	m.items[id] = parent.AddRadio(label, false).OnClick(func(*application.Context) { emit(id) })
}

func (m *Menu) checkbox(parent *application.Menu, id, label, accelerator string, emit func(string)) {
	it := parent.AddCheckbox(label, false).OnClick(func(*application.Context) { emit(id) })
	if accelerator != "" {
		it.SetAccelerator(accelerator)
	}
	m.items[id] = it
}

// Apply mutates item properties, batched into one main-thread hop; unknown ids are skipped.
func (m *Menu) Apply(states []ItemState) {
	application.InvokeAsync(func() {
		for _, st := range states {
			it, ok := m.items[st.ID]
			if !ok {
				continue
			}
			if st.Label != "" {
				it.SetLabel(st.Label)
			}
			if st.Checked != nil {
				it.SetChecked(*st.Checked)
			}
			if st.Enabled != nil {
				it.SetEnabled(*st.Enabled)
			}
			if st.Accelerator != "" {
				it.SetAccelerator(st.Accelerator)
			}
		}
	})
}

// ParseStates decodes a SyncEvent payload, which arrives as generic JSON.
func ParseStates(data any) ([]ItemState, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	var states []ItemState
	if err := json.Unmarshal(raw, &states); err != nil {
		return nil, err
	}
	return states, nil
}
