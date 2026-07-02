import { MONACO_FONT_METRICS_OPTIONS } from '@/features/editor/lib/monacoFontMetrics';
import { settings } from '@/shared/lib/settingsStore';
import { STORAGE_KEYS } from '@/shared/lib/storageKeys';

export const DEFAULT_EDITOR_FONT_SIZE = 13;
export const MIN_EDITOR_FONT_SIZE = 10;
export const MAX_EDITOR_FONT_SIZE = 24;

const STORAGE_KEY = STORAGE_KEYS.editorFontSize;

type FontSizeListener = (size: number) => void;

const listeners = new Set<FontSizeListener>();

function clampFontSize(size: number): number {
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, Math.round(size)));
}

export function readStoredEditorFontSize(): number {
  try {
    const raw = settings.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_EDITOR_FONT_SIZE;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return clampFontSize(n);
  } catch {
    /* ignore */
  }
  return DEFAULT_EDITOR_FONT_SIZE;
}

export function getEffectiveEditorFontSize(): number {
  return readStoredEditorFontSize();
}

function applyEditorFontSize(size: number): number {
  const next = clampFontSize(size);
  try {
    settings.setItem(STORAGE_KEY, String(next));
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener(next);
  return next;
}

export function decreaseEditorFontSize(): number {
  return applyEditorFontSize(readStoredEditorFontSize() - 1);
}

export function increaseEditorFontSize(): number {
  return applyEditorFontSize(readStoredEditorFontSize() + 1);
}

export function resetEditorFontSize(): number {
  return applyEditorFontSize(DEFAULT_EDITOR_FONT_SIZE);
}

export function subscribeEditorFontSizeChanged(listener: FontSizeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function editorLineHeight(fontSize: number): number {
  return fontSize + 7;
}

export function monacoFontOptions(fontSize: number): {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
} {
  return {
    ...MONACO_FONT_METRICS_OPTIONS,
    fontSize,
    lineHeight: editorLineHeight(fontSize),
  };
}
