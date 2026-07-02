package storage

import (
	"encoding/json"
	"os"
)

// loadJSONFile reads path into a fresh T. A missing file yields the zero value; an unparseable one
// is renamed to a .corrupt-* sibling and also yields the zero value, so the store starts empty
// instead of failing startup. A read failure is returned so the caller can refuse to run rather
// than blindly overwrite the file later.
func loadJSONFile[T any](path string) (T, error) {
	var zero T
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return zero, nil
	}
	if err != nil {
		return zero, err
	}
	var v T
	if json.Unmarshal(data, &v) != nil {
		backupCorruptFile(path)
		return zero, nil
	}
	return v, nil
}

// saveJSONFile writes v as indented JSON via an atomic rename.
func saveJSONFile(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, data, 0o600)
}

// upsertByID replaces the element whose idOf matches id, or appends item when absent.
func upsertByID[T any](items []T, id string, item T, idOf func(T) string) []T {
	for i := range items {
		if idOf(items[i]) == id {
			items[i] = item
			return items
		}
	}
	return append(items, item)
}

// removeByID deletes the element whose idOf matches id, reporting whether it was found.
func removeByID[T any](items []T, id string, idOf func(T) string) ([]T, bool) {
	for i := range items {
		if idOf(items[i]) == id {
			return append(items[:i], items[i+1:]...), true
		}
	}
	return items, false
}
