package storage

import (
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

func historyEntryID(e database.HistoryEntry) string { return e.ID }

// Entries stored oldest-first so Add is O(1); List walks from the tail to return newest-first.
func NewHistoryStore(configDir string) (*HistoryStore, error) {
	h := &HistoryStore{
		path: filepath.Join(configDir, "query_history.json"),
		max:  500,
	}
	entries, err := loadJSONFile[[]database.HistoryEntry](h.path)
	if err != nil {
		return nil, err
	}
	h.entries = entries
	if h.entries == nil {
		h.entries = []database.HistoryEntry{}
	}
	// Trim on load so a manually-edited file doesn't stay oversized until the next Add.
	h.trim()
	return h, nil
}

// trim drops the oldest entries beyond max; callers must hold the write lock (or own h exclusively).
func (h *HistoryStore) trim() {
	if over := len(h.entries) - h.max; over > 0 {
		h.entries = append(h.entries[:0], h.entries[over:]...)
	}
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
	h.trim()
	return entry, h.saveLocked()
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
	var found bool
	if h.entries, found = removeByID(h.entries, id, historyEntryID); !found {
		return false, nil
	}
	return true, h.saveLocked()
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
	return h.saveLocked()
}

func (h *HistoryStore) saveLocked() error {
	return saveJSONFile(h.path, h.entries)
}
