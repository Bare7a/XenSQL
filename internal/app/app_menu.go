package app

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"xensql/internal/appmenu"
)

// SetNativeMenu hands over the macOS menu bar; its sync listener attaches in ServiceStartup.
func (a *App) SetNativeMenu(menu *appmenu.Menu) {
	a.nativeMenu = menu
}

func (a *App) EmitMenuAction(id string) {
	a.emit(appmenu.ActionEvent, id)
}

func (a *App) listenNativeMenuSync() {
	if a.nativeMenu == nil {
		return
	}
	a.app.Event.On(appmenu.SyncEvent, func(e *application.CustomEvent) {
		states, err := appmenu.ParseStates(e.Data)
		if err != nil {
			a.logErrorf("menu sync: %v", err)
			return
		}
		a.nativeMenu.Apply(states)
	})
}
