// Synchronous, localStorage-shaped facade over the Go settings store. Prefs live
// in the portable settings.json (not the non-relocatable WebView localStorage);
// Go calls are async, so we hydrate a cache at startup and write through to Go.

import { DeleteSetting, GetSettings, SetSetting } from '@bindings/xensql/internal/app/app';

let cache = new Map<string, string>();

// Load persisted settings into the cache. Call once, before init/render.
export async function hydrateSettings(): Promise<void> {
  try {
    const loaded = await GetSettings();
    cache = new Map(Object.entries((loaded ?? {}) as Record<string, string>));
  } catch {
    cache = new Map();
  }
}

// Fire-and-forget write to Go, swallowing a sync throw (runtime not ready) or an
// async rejection - the cache is already set, so a failure just delays disk.
function persist(write: () => Promise<unknown>): void {
  try {
    void write().catch(() => {
      /* ignore */
    });
  } catch {
    /* runtime unavailable */
  }
}

// Storage-shaped: synchronous reads/writes over the cache, persisted to Go async.
export const settings = {
  getItem(key: string): string | null {
    return cache.has(key) ? (cache.get(key) as string) : null;
  },
  setItem(key: string, value: string): void {
    cache.set(key, value);
    persist(() => SetSetting(key, value));
  },
  removeItem(key: string): void {
    cache.delete(key);
    persist(() => DeleteSetting(key));
  },
};

// Mirror a boot-critical key (theme, language) to localStorage too, so index.html's
// inline script can read it synchronously before the bundle loads. settings.json
// stays authoritative; best-effort, never throws.
export function mirrorBootSetting(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* ignore */
  }
}

// Test helper: clear the cache.
export function resetSettingsForTests(): void {
  cache = new Map();
}
