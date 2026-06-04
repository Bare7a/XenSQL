package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"xensql/internal/database"
)

type SavedQueriesStore struct {
	mu      sync.RWMutex
	path    string
	queries []database.SavedQuery
}

func NewSavedQueriesStore(configDir string) (*SavedQueriesStore, error) {
	s := &SavedQueriesStore{path: filepath.Join(configDir, "saved_queries.json")}
	if data, err := os.ReadFile(s.path); err == nil {
		if json.Unmarshal(data, &s.queries) != nil {
			s.queries = nil
			backupCorruptFile(s.path)
		}
	}
	if s.queries == nil {
		s.queries = []database.SavedQuery{}
	}
	return s, nil
}

func (s *SavedQueriesStore) List(connectionID string) []database.SavedQuery {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]database.SavedQuery, 0, len(s.queries))
	for _, q := range s.queries {
		if connectionID != "" && q.ConnectionID != "" && q.ConnectionID != connectionID {
			continue
		}
		out = append(out, q)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

func (s *SavedQueriesStore) Save(q database.SavedQuery) (database.SavedQuery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().Format(time.RFC3339)
	if q.ID == "" {
		q.ID = uuid.NewString()
		q.CreatedAt = now
	}
	q.UpdatedAt = now
	if q.CreatedAt == "" {
		q.CreatedAt = now
	}
	found := false
	for i, existing := range s.queries {
		if existing.ID == q.ID {
			s.queries[i] = q
			found = true
			break
		}
	}
	if !found {
		s.queries = append(s.queries, q)
	}
	return q, s.persist()
}

func (s *SavedQueriesStore) Delete(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, q := range s.queries {
		if q.ID == id {
			s.queries = append(s.queries[:i], s.queries[i+1:]...)
			return true, s.persist()
		}
	}
	return false, nil
}

func (s *SavedQueriesStore) persist() error {
	queries := s.queries
	if queries == nil {
		queries = []database.SavedQuery{}
	}
	data, err := json.MarshalIndent(queries, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(s.path, data, 0o600)
}
