package storage

import (
	"path/filepath"
	"sync"
)

// SettingsStore is a flat key/value store persisted as settings.json, holding the
// frontend's preferences in the portable data dir (not the WebView's localStorage).
type SettingsStore struct {
	mu     sync.RWMutex
	path   string
	values map[string]string
}

func NewSettingsStore(configDir string) (*SettingsStore, error) {
	s := &SettingsStore{path: filepath.Join(configDir, "settings.json")}
	values, err := loadJSONFile[map[string]string](s.path)
	if err != nil {
		return nil, err
	}
	s.values = values
	if s.values == nil { // covers both a missing file and a literal JSON null
		s.values = map[string]string{}
	}
	return s, nil
}

// GetAll returns a copy; the internal map is never exposed under the lock.
func (s *SettingsStore) GetAll() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]string, len(s.values))
	for k, v := range s.values {
		out[k] = v
	}
	return out
}

func (s *SettingsStore) Set(key, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[key] = value
	return s.saveLocked()
}

func (s *SettingsStore) Delete(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.values[key]; !ok {
		return nil
	}
	delete(s.values, key)
	return s.saveLocked()
}

// saveLocked persists the current map atomically; callers must hold the write lock.
func (s *SettingsStore) saveLocked() error {
	return saveJSONFile(s.path, s.values)
}
