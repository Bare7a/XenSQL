package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/google/uuid"

	"xensql/internal/database"
)

type ConnectionFolder struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Store struct {
	mu          sync.RWMutex
	path        string
	Connections []database.ConnectionConfig `json:"connections"`
	Folders     []ConnectionFolder          `json:"folders"`
}

func NewStore(configDir string) (*Store, error) {
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(configDir, "connections.json")}
	if err := s.load(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	s.normalizeSlices()
	return s, nil
}

func (s *Store) normalizeSlices() {
	if s.Connections == nil {
		s.Connections = []database.ConnectionConfig{}
	}
	if s.Folders == nil {
		s.Folders = []ConnectionFolder{}
	}
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := json.Unmarshal(data, s); err != nil {
		// Corrupt file: back it up and start empty instead of failing startup, matching the other stores.
		backupCorruptFile(s.path)
		s.Connections = nil
		s.Folders = nil
		return nil
	}
	s.normalizeSlices()
	return nil
}

func (s *Store) ListConnections() []database.ConnectionConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]database.ConnectionConfig, len(s.Connections))
	copy(out, s.Connections)
	return out
}

func (s *Store) GetConnection(id string) (database.ConnectionConfig, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, c := range s.Connections {
		if c.ID == id {
			return c, true
		}
	}
	return database.ConnectionConfig{}, false
}

func (s *Store) SaveConnection(cfg database.ConnectionConfig) (database.ConnectionConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cfg.ID == "" {
		cfg.ID = uuid.NewString()
	}
	if cfg.Color == "" {
		cfg.Color = "#3b82f6"
	}
	found := false
	for i, c := range s.Connections {
		if c.ID == cfg.ID {
			s.Connections[i] = cfg
			found = true
			break
		}
	}
	if !found {
		s.Connections = append(s.Connections, cfg)
	}
	return cfg, s.saveUnlocked()
}

func (s *Store) DeleteConnection(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, c := range s.Connections {
		if c.ID == id {
			s.Connections = append(s.Connections[:i], s.Connections[i+1:]...)
			return true, s.saveUnlocked()
		}
	}
	return false, nil
}

// Unknown IDs are silently skipped; connections absent from orderedIDs are appended in their prior order.
func (s *Store) ReorderConnections(orderedIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.Connections) == 0 {
		return nil
	}
	byID := make(map[string]database.ConnectionConfig, len(s.Connections))
	for _, c := range s.Connections {
		byID[c.ID] = c
	}
	reordered := make([]database.ConnectionConfig, 0, len(s.Connections))
	seen := make(map[string]bool, len(s.Connections))
	for _, id := range orderedIDs {
		if c, ok := byID[id]; ok {
			reordered = append(reordered, c)
			seen[id] = true
		}
	}
	for _, c := range s.Connections {
		if !seen[c.ID] {
			reordered = append(reordered, c)
		}
	}
	s.Connections = reordered
	return s.saveUnlocked()
}

func (s *Store) ListFolders() []ConnectionFolder {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]ConnectionFolder, len(s.Folders))
	copy(out, s.Folders)
	return out
}

func (s *Store) SaveFolder(f ConnectionFolder) (ConnectionFolder, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if f.ID == "" {
		f.ID = uuid.NewString()
	}
	found := false
	for i, folder := range s.Folders {
		if folder.ID == f.ID {
			s.Folders[i] = f
			found = true
			break
		}
	}
	if !found {
		s.Folders = append(s.Folders, f)
	}
	return f, s.saveUnlocked()
}

func (s *Store) DeleteFolder(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, f := range s.Folders {
		if f.ID == id {
			s.Folders = append(s.Folders[:i], s.Folders[i+1:]...)
			break
		}
	}
	for i := range s.Connections {
		if s.Connections[i].FolderID == id {
			s.Connections[i].FolderID = ""
		}
	}
	return s.saveUnlocked()
}

func (s *Store) saveUnlocked() error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(s.path, data, 0o600)
}
