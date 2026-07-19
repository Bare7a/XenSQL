package app

import (
	"context"
	"time"
)

// startupCheckDelay lets the app finish launching before the silent check runs.
const startupCheckDelay = 5 * time.Second

// updateAvailableEvent is the "update-available" payload the frontend toast reads.
type updateAvailableEvent struct {
	Version string `json:"version"`
}

// CheckForUpdates opens the built-in update window and runs the full flow
// (download, verify, Restart & Apply). Bound to the About dialog's button.
func (a *App) CheckForUpdates() {
	if a.app == nil {
		return
	}
	go func() {
		if err := a.app.Updater.CheckAndInstall(context.Background()); err != nil {
			a.logErrorf("update check: %v", err)
		}
	}()
}

// startBackgroundUpdateCheck runs the silent launch-time check, but only in
// production builds (autoCheckUpdatesOnStartup) so dev runs aren't disturbed.
func (a *App) startBackgroundUpdateCheck() {
	if !autoCheckUpdatesOnStartup || a.app == nil {
		return
	}
	go a.runBackgroundUpdateCheck()
}

// runBackgroundUpdateCheck checks without opening any window. When a newer
// release is found it emits "update-available" so the UI can show a dismissible
// toast; offline, errored, up-to-date and skipped cases all stay silent.
func (a *App) runBackgroundUpdateCheck() {
	select {
	case <-time.After(startupCheckDelay):
	case <-a.ctx.Done():
		return
	}
	rel, err := a.app.Updater.Check(a.ctx)
	if err != nil {
		// Offline is the common case; log at debug, never surface it.
		a.app.Logger.Debug("background update check failed", "error", err)
		return
	}
	if rel == nil {
		return
	}
	a.emit("update-available", updateAvailableEvent{Version: rel.Version})
}
