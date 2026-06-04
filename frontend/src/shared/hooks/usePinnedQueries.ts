import { useCallback, useMemo, useState } from 'react';
import { readStoredJson, writeStoredJson, STORAGE_KEYS } from '@/shared/lib/storageKeys';

// Persisted client-side only - the SavedQuery backend has no pin field.
export function usePinnedQueries(): {
  pinned: Set<string>;
  isPinned: (id: string) => boolean;
  toggle: (id: string) => void;
} {
  const [ids, setIds] = useState<string[]>(() =>
    readStoredJson<string[]>(STORAGE_KEYS.pinnedQueries, [])
  );

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeStoredJson(STORAGE_KEYS.pinnedQueries, next);
      return next;
    });
  }, []);

  const pinned = useMemo(() => new Set(ids), [ids]);
  const isPinned = useCallback((id: string) => pinned.has(id), [pinned]);
  return { pinned, isPinned, toggle };
}
