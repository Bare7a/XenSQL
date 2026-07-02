package storage

import (
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

func savedQueryID(q database.SavedQuery) string { return q.ID }

func NewSavedQueriesStore(configDir string) (*SavedQueriesStore, error) {
	s := &SavedQueriesStore{path: filepath.Join(configDir, "saved_queries.json")}
	queries, err := loadJSONFile[[]database.SavedQuery](s.path)
	if err != nil {
		return nil, err
	}
	s.queries = queries
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
	s.queries = upsertByID(s.queries, q.ID, q, savedQueryID)
	return q, s.saveLocked()
}

func (s *SavedQueriesStore) Delete(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var found bool
	if s.queries, found = removeByID(s.queries, id, savedQueryID); !found {
		return false, nil
	}
	return true, s.saveLocked()
}

func (s *SavedQueriesStore) saveLocked() error {
	return saveJSONFile(s.path, s.queries)
}
