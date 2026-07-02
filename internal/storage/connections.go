package storage

import (
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

// connectionsFile is the on-disk shape of connections.json.
type connectionsFile struct {
	Connections []database.ConnectionConfig `json:"connections"`
	Folders     []ConnectionFolder          `json:"folders"`
}

type Store struct {
	mu          sync.RWMutex
	path        string
	connections []database.ConnectionConfig
	folders     []ConnectionFolder
}

func NewStore(configDir string) (*Store, error) {
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(configDir, "connections.json")}
	file, err := loadJSONFile[connectionsFile](s.path)
	if err != nil {
		return nil, err
	}
	s.connections = file.Connections
	s.folders = file.Folders
	if s.connections == nil {
		s.connections = []database.ConnectionConfig{}
	}
	if s.folders == nil {
		s.folders = []ConnectionFolder{}
	}
	return s, nil
}

func connectionID(c database.ConnectionConfig) string { return c.ID }

func folderID(f ConnectionFolder) string { return f.ID }

func (s *Store) ListConnections() []database.ConnectionConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]database.ConnectionConfig, len(s.connections))
	copy(out, s.connections)
	return out
}

func (s *Store) GetConnection(id string) (database.ConnectionConfig, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, c := range s.connections {
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
	s.connections = upsertByID(s.connections, cfg.ID, cfg, connectionID)
	return cfg, s.saveLocked()
}

func (s *Store) DeleteConnection(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var found bool
	if s.connections, found = removeByID(s.connections, id, connectionID); !found {
		return false, nil
	}
	return true, s.saveLocked()
}

// Unknown IDs are silently skipped; connections absent from orderedIDs are appended in their prior order.
func (s *Store) ReorderConnections(orderedIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.connections) == 0 {
		return nil
	}
	byID := make(map[string]database.ConnectionConfig, len(s.connections))
	for _, c := range s.connections {
		byID[c.ID] = c
	}
	reordered := make([]database.ConnectionConfig, 0, len(s.connections))
	seen := make(map[string]bool, len(s.connections))
	for _, id := range orderedIDs {
		if c, ok := byID[id]; ok {
			reordered = append(reordered, c)
			seen[id] = true
		}
	}
	for _, c := range s.connections {
		if !seen[c.ID] {
			reordered = append(reordered, c)
		}
	}
	s.connections = reordered
	return s.saveLocked()
}

func (s *Store) ListFolders() []ConnectionFolder {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]ConnectionFolder, len(s.folders))
	copy(out, s.folders)
	return out
}

func (s *Store) SaveFolder(f ConnectionFolder) (ConnectionFolder, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if f.ID == "" {
		f.ID = uuid.NewString()
	}
	s.folders = upsertByID(s.folders, f.ID, f, folderID)
	return f, s.saveLocked()
}

func (s *Store) DeleteFolder(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.folders, _ = removeByID(s.folders, id, folderID)
	for i := range s.connections {
		if s.connections[i].FolderID == id {
			s.connections[i].FolderID = ""
		}
	}
	return s.saveLocked()
}

// saveLocked persists the store; callers must hold the write lock.
func (s *Store) saveLocked() error {
	return saveJSONFile(s.path, connectionsFile{Connections: s.connections, Folders: s.folders})
}
