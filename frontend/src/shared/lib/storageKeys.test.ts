import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, readStoredBool, writeStoredBool } from '@/shared/lib/storageKeys';
import { settings, resetSettingsForTests } from '@/shared/lib/settingsStore';

// No Wails bindings in the node test env; settingsStore swallows the Go calls, so
// its in-memory cache is the full surface under test.
beforeEach(() => {
  resetSettingsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('STORAGE_KEYS', () => {
  it('keeps the documented legacy keys stable so user prefs survive upgrades', () => {
    expect(STORAGE_KEYS.sidebarWidth).toBe('xensql-sidebar-w');
    expect(STORAGE_KEYS.sidebarOpen).toBe('xensql-sidebar-open');
    expect(STORAGE_KEYS.jsonPanelWidth).toBe('xensql-json-w');
    expect(STORAGE_KEYS.jsonPanelOpen).toBe('xensql-json-open');
    expect(STORAGE_KEYS.editorFontSize).toBe('xensql-editor-font-size');
    expect(STORAGE_KEYS.exportFormat).toBe('xensql-export-format');
    expect(STORAGE_KEYS.uiZoomPx).toBe('xensql-ui-zoom-px');
    expect(STORAGE_KEYS.shortcuts).toBe('xensql-shortcut-overrides');
    expect(STORAGE_KEYS.theme).toBe('xensql-theme');
    expect(STORAGE_KEYS.language).toBe('xensql-language');
  });
});

describe('readStoredBool', () => {
  it('returns fallback when key is absent', () => {
    expect(readStoredBool(STORAGE_KEYS.sidebarOpen, true)).toBe(true);
    expect(readStoredBool(STORAGE_KEYS.sidebarOpen, false)).toBe(false);
  });
  it('reads "1" as true and everything else as false', () => {
    settings.setItem(STORAGE_KEYS.sidebarOpen, '1');
    expect(readStoredBool(STORAGE_KEYS.sidebarOpen, false)).toBe(true);
    settings.setItem(STORAGE_KEYS.sidebarOpen, '0');
    expect(readStoredBool(STORAGE_KEYS.sidebarOpen, true)).toBe(false);
  });
  it('falls back when getItem throws (e.g. privacy mode)', () => {
    vi.spyOn(settings, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredBool(STORAGE_KEYS.sidebarOpen, true)).toBe(true);
  });
});

describe('writeStoredBool', () => {
  it('persists as "1"/"0"', () => {
    const setItem = vi.spyOn(settings, 'setItem');
    writeStoredBool(STORAGE_KEYS.sidebarOpen, true);
    expect(setItem).toHaveBeenLastCalledWith(STORAGE_KEYS.sidebarOpen, '1');
    writeStoredBool(STORAGE_KEYS.sidebarOpen, false);
    expect(setItem).toHaveBeenLastCalledWith(STORAGE_KEYS.sidebarOpen, '0');
  });
  it('silently no-ops when setItem throws', () => {
    vi.spyOn(settings, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writeStoredBool(STORAGE_KEYS.sidebarOpen, true)).not.toThrow();
  });
});
