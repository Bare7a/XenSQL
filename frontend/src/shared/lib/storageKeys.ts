// Prefixed xensql- to avoid origin collisions with the embedded webview
import { settings } from '@/shared/lib/settingsStore';

export const STORAGE_KEYS = {
  sidebarWidth: 'xensql-sidebar-w',
  sidebarOpen: 'xensql-sidebar-open',
  jsonPanelWidth: 'xensql-json-w',
  jsonPanelOpen: 'xensql-json-open',
  editorFontSize: 'xensql-editor-font-size',
  exportFormat: 'xensql-export-format',
  uiZoomPx: 'xensql-ui-zoom-px',
  shortcuts: 'xensql-shortcut-overrides',
  theme: 'xensql-theme',
  language: 'xensql-language',
  queriesMode: 'xensql-queries-mode',
  savedSort: 'xensql-saved-sort',
  pinnedQueries: 'xensql-pinned-queries',
  schemaExpanded: 'xensql-schema-expanded',
  schemaTablesExpanded: 'xensql-schema-tables-expanded',
  foldersCollapsed: 'xensql-folders-collapsed',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export function readStoredBool(key: StorageKey, fallback: boolean): boolean {
  try {
    const v = settings.getItem(key);
    if (v == null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}

export function writeStoredBool(key: StorageKey, value: boolean): void {
  try {
    settings.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function readStoredString(key: StorageKey, fallback: string): string {
  try {
    return settings.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredString(key: StorageKey, value: string): void {
  try {
    settings.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function readStoredJson<T>(key: StorageKey, fallback: T): T {
  try {
    const raw = settings.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeStoredJson<T>(key: StorageKey, value: T): void {
  try {
    settings.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
