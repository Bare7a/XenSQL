package app

import "fmt"

func (a *App) GetSettings() map[string]string {
	if a.settings == nil {
		return map[string]string{}
	}
	return a.settings.GetAll()
}

// SetSetting persists one preference; keys (e.g. "xensql-theme") are opaque here.
func (a *App) SetSetting(key, value string) error {
	if a.settings == nil {
		return fmt.Errorf("settings store unavailable")
	}
	return a.settings.Set(key, value)
}

func (a *App) DeleteSetting(key string) error {
	if a.settings == nil {
		return fmt.Errorf("settings store unavailable")
	}
	return a.settings.Delete(key)
}
