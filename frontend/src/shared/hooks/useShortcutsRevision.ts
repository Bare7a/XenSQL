import { useSyncExternalStore } from 'react';
import { getShortcutsRevision, subscribeShortcutsChanged } from '@/shared/lib/shortcuts';

// Re-renders the caller whenever a binding is remapped or reset; the number itself only
// matters as a cache key for consumers that memoize on it.
export function useShortcutsRevision(): number {
  return useSyncExternalStore(subscribeShortcutsChanged, getShortcutsRevision);
}
