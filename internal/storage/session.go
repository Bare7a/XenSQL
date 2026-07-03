package storage

import (
	"path/filepath"
	"sync"
)

type TableViewRef struct {
	Schema        string   `json:"schema"`
	Table         string   `json:"table"`
	Filter        string   `json:"filter,omitempty"`
	OrderBy       string   `json:"orderBy,omitempty"`
	OrderDir      string   `json:"orderDir,omitempty"`
	HiddenColumns []string `json:"hiddenColumns,omitempty"`
}

type EditorTab struct {
	ID               string        `json:"id"`
	ConnectionID     string        `json:"connectionId"`
	Title            string        `json:"title"`
	SQL              string        `json:"sql"`
	Color            string        `json:"color"`
	SavedQueryID     string        `json:"savedQueryId,omitempty"`
	SavedSQLBaseline string        `json:"savedSqlBaseline,omitempty"`
	TableView        *TableViewRef `json:"tableView,omitempty"`
}

type EditorSession struct {
	Tabs      []EditorTab `json:"tabs"`
	ActiveTab string      `json:"activeTab"`
}

type SessionStore struct {
	mu   sync.RWMutex
	path string
	data EditorSession
}

func NewSessionStore(configDir string) (*SessionStore, error) {
	s := &SessionStore{path: filepath.Join(configDir, "editor_session.json")}
	data, err := loadJSONFile[EditorSession](s.path)
	if err != nil {
		return nil, err
	}
	s.data = data
	if s.data.Tabs == nil {
		s.data.Tabs = []EditorTab{}
	}
	return s, nil
}

func (s *SessionStore) Get() EditorSession {
	s.mu.RLock()
	defer s.mu.RUnlock()
	// Copy the slice so callers never touch the internal backing array without the lock.
	out := s.data
	if s.data.Tabs != nil {
		out.Tabs = make([]EditorTab, len(s.data.Tabs))
		copy(out.Tabs, s.data.Tabs)
	}
	return out
}

func (s *SessionStore) Save(session EditorSession) error {
	if session.Tabs == nil {
		session.Tabs = []EditorTab{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = session
	return saveJSONFile(s.path, session)
}
