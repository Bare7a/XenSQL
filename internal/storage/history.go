package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"

	"xensql/internal/database"
)

type HistoryStore struct {
	mu      sync.RWMutex
	path    string
	entries []database.HistoryEntry
	max     int
}

// Entries stored oldest-first so Add is O(1); List walks from the tail to return newest-first.
func NewHistoryStore(configDir string) (*HistoryStore, error) {
	h := &HistoryStore{
		path: filepath.Join(configDir, "query_history.json"),
		max:  500,
	}
	if data, err := os.ReadFile(h.path); err == nil {
		var loaded []database.HistoryEntry
		if json.Unmarshal(data, &loaded) == nil {
			h.entries = loaded
		} else {
			backupCorruptFile(h.path)
		}
	}
	if h.entries == nil {
		h.entries = []database.HistoryEntry{}
	}
	// Trim on load so a manually-edited file doesn't stay oversized until the next Add.
	if over := len(h.entries) - h.max; over > 0 {
		h.entries = append(h.entries[:0], h.entries[over:]...)
	}
	return h, nil
}

func (h *HistoryStore) Add(entry database.HistoryEntry) (database.HistoryEntry, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if entry.ID == "" {
		entry.ID = uuid.NewString()
	}
	if entry.ExecutedAt == "" {
		entry.ExecutedAt = time.Now().Format(time.RFC3339)
	}
	h.entries = append(h.entries, entry)
	if over := len(h.entries) - h.max; over > 0 {
		h.entries = append(h.entries[:0], h.entries[over:]...)
	}
	return entry, h.persist()
}

func (h *HistoryStore) List(connectionID string, limit int) []database.HistoryEntry {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if limit <= 0 {
		limit = 100
	}
	out := make([]database.HistoryEntry, 0, limit)
	for i := len(h.entries) - 1; i >= 0 && len(out) < limit; i-- {
		e := h.entries[i]
		if connectionID != "" && e.ConnectionID != connectionID {
			continue
		}
		out = append(out, e)
	}
	return out
}

func (h *HistoryStore) Delete(id string) (bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i, e := range h.entries {
		if e.ID == id {
			h.entries = append(h.entries[:i], h.entries[i+1:]...)
			return true, h.persist()
		}
	}
	return false, nil
}

func (h *HistoryStore) Clear(connectionID string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if connectionID == "" {
		h.entries = []database.HistoryEntry{}
	} else {
		filtered := make([]database.HistoryEntry, 0, len(h.entries))
		for _, e := range h.entries {
			if e.ConnectionID != connectionID {
				filtered = append(filtered, e)
			}
		}
		h.entries = filtered
	}
	return h.persist()
}

func (h *HistoryStore) persist() error {
	if len(h.entries) == 0 {
		return writeFileAtomic(h.path, []byte("[]"), 0o600)
	}
	data, err := json.MarshalIndent(h.entries, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(h.path, data, 0o600)
}
