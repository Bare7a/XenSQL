package app

import (
	"fmt"

	"xensql/internal/database"
	"xensql/internal/storage"
)

func (a *App) recordHistory(connectionID, sql string, result *database.QueryResult, err error) {
	if a.history == nil {
		return
	}
	entry := database.HistoryEntry{
		ConnectionID: connectionID,
		SQL:          sql,
		Success:      err == nil,
	}
	if err != nil {
		entry.Error = err.Error()
	}
	if result != nil {
		entry.DurationMs = result.DurationMs
	}
	if _, err := a.history.Add(entry); err != nil {
		a.logErrorf("history save: %v", err)
	}
}

func (a *App) GetQueryHistory(connectionID string, limit int) []database.HistoryEntry {
	if a.history == nil {
		return []database.HistoryEntry{}
	}
	return a.history.List(connectionID, limit)
}

func (a *App) ClearQueryHistory(connectionID string) error {
	if a.history == nil {
		return fmt.Errorf("history store unavailable")
	}
	return a.history.Clear(connectionID)
}

func (a *App) DeleteQueryHistoryEntry(id string) bool {
	if a.history == nil {
		return false
	}
	ok, err := a.history.Delete(id)
	if err != nil {
		return false
	}
	return ok
}

func (a *App) ListSavedQueries(connectionID string) []database.SavedQuery {
	if a.savedQueries == nil {
		return []database.SavedQuery{}
	}
	entries := a.savedQueries.List(connectionID)
	if entries == nil {
		return []database.SavedQuery{}
	}
	return entries
}

func (a *App) SaveSavedQuery(q database.SavedQuery) (database.SavedQuery, error) {
	if a.savedQueries == nil {
		return q, fmt.Errorf("saved queries store unavailable")
	}
	return a.savedQueries.Save(q)
}

func (a *App) DeleteSavedQuery(id string) bool {
	if a.savedQueries == nil {
		return false
	}
	ok, err := a.savedQueries.Delete(id)
	if err != nil {
		return false
	}
	return ok
}

func (a *App) GetEditorSession() storage.EditorSession {
	if a.session == nil {
		return storage.EditorSession{}
	}
	return a.session.Get()
}

func (a *App) SaveEditorSession(session storage.EditorSession) error {
	if a.session == nil {
		return fmt.Errorf("session store unavailable")
	}
	return a.session.Save(session)
}
