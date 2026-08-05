import { useEffect, useState } from 'react';
import { api } from '@/shared/lib/api';
import { DEFAULT_PATH_DEFAULTS, type PathDefaults } from '@/shared/lib/pathDefaults';

// Cached for the session; the host cannot change while the app is open.
let cached: PathDefaults | null = null;

export function usePathDefaults(): PathDefaults {
  const [defaults, setDefaults] = useState<PathDefaults>(cached ?? DEFAULT_PATH_DEFAULTS);
  useEffect(() => {
    if (cached) return;
    void api
      .getPathDefaults()
      .then((value) => {
        cached = value;
        setDefaults(value);
      })
      .catch(() => setDefaults(DEFAULT_PATH_DEFAULTS));
  }, []);
  return defaults;
}
