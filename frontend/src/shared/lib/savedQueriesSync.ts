import { api } from '@/shared/lib/api';
import { useAppStore } from '@/store/appStore';
import type { SavedQuery } from '@/types';

let refreshInflight: Promise<SavedQuery[]> | null = null;

/** Reload the full saved-query list from the backend into appStore (deduped while in flight). */
export function refreshSavedQueries(): Promise<SavedQuery[]> {
  if (refreshInflight) return refreshInflight;

  refreshInflight = (async () => {
    try {
      const list = await api.listSavedQueries('');
      useAppStore.getState().setSavedQueries(list);
      return list;
    } catch {
      useAppStore.getState().setSavedQueries([]);
      return [];
    } finally {
      refreshInflight = null;
    }
  })();

  return refreshInflight;
}
