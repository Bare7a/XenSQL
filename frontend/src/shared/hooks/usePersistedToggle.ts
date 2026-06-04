import { useCallback, useState } from 'react';
import {
  readStoredBool,
  writeStoredBool,
  type StorageKey,
} from '@/shared/lib/storageKeys';

// Boolean toggle persisted to the settings store (e.g. sidebar/JSON-panel visibility); survives reload.
export function usePersistedToggle(
  key: StorageKey,
  defaultValue: boolean
): {
  value: boolean;
  toggle: () => void;
  set: (next: boolean) => void;
} {
  const [value, setValue] = useState(() => readStoredBool(key, defaultValue));

  const toggle = useCallback(() => {
    setValue((prev) => {
      const next = !prev;
      writeStoredBool(key, next);
      return next;
    });
  }, [key]);

  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      writeStoredBool(key, next);
    },
    [key]
  );

  return { value, toggle, set };
}
