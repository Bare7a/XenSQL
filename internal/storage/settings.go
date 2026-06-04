package storage

import (
	"encoding/json"
	"os"
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
	s := &SettingsStore{
		path:   filepath.Join(configDir, "settings.json"),
		values: map[string]string{},
	}
	if data, err := os.ReadFile(s.path); err == nil {
		if json.Unmarshal(data, &s.values) != nil || s.values == nil {
			s.values = map[string]string{}
			backupCorruptFile(s.path)
		}
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
	return s.persist()
}

func (s *SettingsStore) Delete(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.values[key]; !ok {
		return nil
	}
	delete(s.values, key)
	return s.persist()
}

// persist writes the current map atomically. Callers must hold the write lock.
func (s *SettingsStore) persist() error {
	data, err := json.MarshalIndent(s.values, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(s.path, data, 0o600)
}
