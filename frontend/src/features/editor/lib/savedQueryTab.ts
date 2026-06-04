import type { EditorTab, SavedQuery } from '@/types';

export function isSavedQueryTabDirty(tab: EditorTab): boolean {
  if (!tab.savedQueryId) return false;
  const baseline = tab.savedSqlBaseline ?? '';
  return tab.sql !== baseline;
}

// Finds tab by savedQueryId, or falls back to an unbound same-title/connection tab (opened before linking).
export function findTabForSavedQuery(
  tabs: EditorTab[],
  saved: SavedQuery
): EditorTab | undefined {
  const linked = tabs.find((t) => t.savedQueryId === saved.id);
  if (linked) return linked;

  return tabs.find(
    (t) =>
      !t.savedQueryId &&
      t.title === saved.name &&
      (!saved.connectionId || t.connectionId === saved.connectionId)
  );
}

export function isSavedQueryOpenInTabs(tabs: EditorTab[], saved: SavedQuery): boolean {
  return findTabForSavedQuery(tabs, saved) != null;
}
