import { settings } from '@/shared/lib/settingsStore';
import { STORAGE_KEYS } from '@/shared/lib/storageKeys';

export interface KeyBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDef {
  id: string;
  category: 'query' | 'tabs' | 'view';
  scope: 'global' | 'editor';
  defaultBinding: KeyBinding;
}

export const APP_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'quickSearch',
    category: 'tabs',
    scope: 'global',
    defaultBinding: { key: 'p', ctrl: true },
  },
  {
    id: 'runSelection',
    category: 'query',
    scope: 'editor',
    defaultBinding: { key: 'Enter', ctrl: true },
  },
  {
    id: 'runAll',
    category: 'query',
    scope: 'editor',
    defaultBinding: { key: 'Enter', ctrl: true, shift: true },
  },
  {
    id: 'saveQuery',
    category: 'query',
    scope: 'editor',
    defaultBinding: { key: 's', ctrl: true },
  },
  {
    id: 'renameSavedQuery',
    category: 'query',
    scope: 'editor',
    defaultBinding: { key: 'F2' },
  },
  {
    id: 'newTab',
    category: 'tabs',
    scope: 'global',
    defaultBinding: { key: 't', ctrl: true },
  },
  {
    id: 'closeTab',
    category: 'tabs',
    scope: 'global',
    defaultBinding: { key: 'w', ctrl: true },
  },
  {
    id: 'reopenClosedTab',
    category: 'tabs',
    scope: 'global',
    defaultBinding: { key: 't', ctrl: true, shift: true },
  },
  {
    id: 'nextTab',
    category: 'tabs',
    scope: 'global',
    defaultBinding: { key: 'Tab', ctrl: true },
  },
  {
    id: 'prevTab',
    category: 'tabs',
    scope: 'global',
    defaultBinding: { key: 'Tab', ctrl: true, shift: true },
  },
  {
    id: 'toggleSidebar',
    category: 'view',
    scope: 'global',
    defaultBinding: { key: 'b', ctrl: true },
  },
  {
    id: 'toggleJsonPanel',
    category: 'view',
    scope: 'global',
    defaultBinding: { key: 'j', ctrl: true },
  },
  {
    id: 'zoomIn',
    category: 'view',
    scope: 'global',
    defaultBinding: { key: '=', ctrl: true },
  },
  {
    id: 'zoomOut',
    category: 'view',
    scope: 'global',
    defaultBinding: { key: '-', ctrl: true },
  },
  {
    id: 'resetZoom',
    category: 'view',
    scope: 'global',
    defaultBinding: { key: '0', ctrl: true },
  },
  {
    id: 'increaseEditorFontSize',
    category: 'view',
    scope: 'editor',
    defaultBinding: { key: '.', ctrl: true, shift: true },
  },
  {
    id: 'decreaseEditorFontSize',
    category: 'view',
    scope: 'editor',
    defaultBinding: { key: ',', ctrl: true, shift: true },
  },
  {
    id: 'toggleFullscreen',
    category: 'view',
    scope: 'global',
    defaultBinding: { key: 'F11' },
  },
];

const STORAGE_KEY = STORAGE_KEYS.shortcuts;
export const SHORTCUTS_CHANGED_EVENT = 'xensql-shortcuts-changed';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform);

// Prevents global dispatcher from firing actions while the Shortcuts dialog records a new binding
let capturingBinding = false;

export function setCapturingBinding(on: boolean): void {
  capturingBinding = on;
}

export function isCapturingBinding(): boolean {
  return capturingBinding;
}

type OverrideMap = Record<string, KeyBinding>;

function readOverrides(): OverrideMap {
  try {
    const raw = settings.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as OverrideMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeOverrides(overrides: OverrideMap) {
  settings.setItem(STORAGE_KEY, JSON.stringify(overrides));
  window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT));
}

export function getShortcutDef(id: string): ShortcutDef | undefined {
  return APP_SHORTCUTS.find((s) => s.id === id);
}

export function getEffectiveBinding(id: string): KeyBinding {
  const def = getShortcutDef(id);
  if (!def) return { key: '' };
  const overrides = readOverrides();
  return overrides[id] ?? def.defaultBinding;
}

import { t } from '@/i18n';

export function getShortcutLabel(id: string): string {
  return t(`shortcuts.items.${id}`);
}

export function getShortcutCategory(category: ShortcutDef['category']): string {
  return t(`shortcuts.categories.${category}`);
}

export function setShortcutBinding(id: string, binding: KeyBinding) {
  const overrides = readOverrides();
  overrides[id] = binding;
  writeOverrides(overrides);
}

export function resetShortcutBinding(id: string) {
  const overrides = readOverrides();
  delete overrides[id];
  writeOverrides(overrides);
}

export function resetAllShortcutBindings() {
  writeOverrides({});
}

export function bindingKey(binding: KeyBinding): string {
  return [binding.ctrl ? '1' : '0', binding.shift ? '1' : '0', binding.alt ? '1' : '0', binding.key.toLowerCase()].join(
    ':',
  );
}

export function findConflictingShortcut(id: string, binding: KeyBinding): ShortcutDef | undefined {
  const key = bindingKey(binding);
  for (const def of APP_SHORTCUTS) {
    if (def.id === id) continue;
    if (bindingKey(getEffectiveBinding(def.id)) === key) return def;
  }
  return undefined;
}

function formatKeyLabel(key: string): string {
  if (key === 'Tab') return 'Tab';
  if (key === 'Enter') return 'Enter';
  if (key === ' ') return 'Space';
  if (key === '=') return '=';
  if (key === '-') return '−';
  if (key === ',') return ',';
  if (key === '.') return '.';
  if (/^F\d+$/.test(key)) return key;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function formatBinding(binding: KeyBinding): string {
  const parts: string[] = [];
  if (isMac) {
    if (binding.ctrl) parts.push('⌃');
    if (binding.alt) parts.push('⌥');
    if (binding.shift) parts.push('⇧');
    parts.push(formatKeyLabel(binding.key));
    return parts.join('');
  }
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(formatKeyLabel(binding.key));
  return parts.join('+');
}

function eventKeyMatchesBinding(eventKey: string, bindingKey: string): boolean {
  if (bindingKey === 'Tab') return eventKey === 'Tab';
  if (bindingKey === 'Enter') return eventKey === 'Enter';
  if (bindingKey === '=') return eventKey === '=' || eventKey === '+';
  if (bindingKey === '+') return eventKey === '+' || eventKey === '=';
  if (bindingKey.length === 1) {
    return eventKey.toLowerCase() === bindingKey.toLowerCase();
  }
  return eventKey === bindingKey;
}

export function matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
  const wantMod = !!binding.ctrl;
  const hasMod = e.ctrlKey || e.metaKey;
  if (wantMod !== hasMod) return false;
  if (!!binding.shift !== e.shiftKey) return false;
  if (!!binding.alt !== e.altKey) return false;
  return eventKeyMatchesBinding(e.key, binding.key);
}

export function bindingFromKeyboardEvent(e: KeyboardEvent): KeyBinding | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const key = e.key === 'Tab' ? 'Tab' : e.key === 'Enter' ? 'Enter' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return {
    key,
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
  };
}

export function toMonacoKeybinding(monaco: typeof import('monaco-editor'), binding: KeyBinding): number {
  let mod = 0;
  if (binding.ctrl) mod |= monaco.KeyMod.CtrlCmd;
  if (binding.shift) mod |= monaco.KeyMod.Shift;
  if (binding.alt) mod |= monaco.KeyMod.Alt;

  const key = binding.key;
  if (key === 'Enter') return mod | monaco.KeyCode.Enter;
  if (key === 'Tab') return mod | monaco.KeyCode.Tab;
  if (key === '=' || key === '+') return mod | monaco.KeyCode.Equal;
  if (key === '-') return mod | monaco.KeyCode.Minus;
  if (key === ',') return mod | monaco.KeyCode.Comma;
  if (key === '.') return mod | monaco.KeyCode.Period;
  if (key === '0') return mod | monaco.KeyCode.Digit0;
  if (key === 'F11') return mod | monaco.KeyCode.F11;
  if (key.length === 1) {
    const upper = key.toUpperCase();
    const code = monaco.KeyCode[`Key${upper}` as keyof typeof monaco.KeyCode];
    if (typeof code === 'number') return mod | code;
    const digit = monaco.KeyCode[`Digit${key}` as keyof typeof monaco.KeyCode];
    if (typeof digit === 'number') return mod | digit;
  }
  if (key.startsWith('F') && /^F\d+$/.test(key)) {
    const code = monaco.KeyCode[key as keyof typeof monaco.KeyCode];
    if (typeof code === 'number') return mod | code;
  }
  return mod;
}

export function subscribeShortcutsChanged(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener(SHORTCUTS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(SHORTCUTS_CHANGED_EVENT, handler);
}
