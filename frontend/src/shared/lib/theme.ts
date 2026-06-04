import { STORAGE_KEYS } from '@/shared/lib/storageKeys';
import { settings, mirrorBootSetting } from '@/shared/lib/settingsStore';

export type AppTheme = 'dark' | 'light';

export const DEFAULT_THEME: AppTheme = 'dark';

const STORAGE_KEY = STORAGE_KEYS.theme;

type ThemeListener = (theme: AppTheme) => void;

const listeners = new Set<ThemeListener>();

export function readStoredTheme(): AppTheme {
  try {
    const value = settings.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

export function getEffectiveTheme(): AppTheme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  return DEFAULT_THEME;
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  // Go is the source of truth; localStorage is the boot-script mirror. Kept in sync.
  settings.setItem(STORAGE_KEY, theme);
  mirrorBootSetting(STORAGE_KEY, theme);
  for (const listener of listeners) listener(theme);
}

export function subscribeThemeChanged(listener: ThemeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initTheme(): AppTheme {
  const theme = readStoredTheme();
  applyTheme(theme);
  return theme;
}
