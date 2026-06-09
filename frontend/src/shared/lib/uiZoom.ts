// html root font-size zoom; Monaco editor font size is independent.

import { settings } from '@/shared/lib/settingsStore';
import { STORAGE_KEYS } from '@/shared/lib/storageKeys';

export const DEFAULT_UI_ZOOM_PX = 13;
export const MIN_UI_ZOOM_PX = 10;
export const MAX_UI_ZOOM_PX = 22;
export const UI_ZOOM_STEP_PX = 1;

const STORAGE_KEY = STORAGE_KEYS.uiZoomPx;

type UiZoomListener = (px: number) => void;

const listeners = new Set<UiZoomListener>();

function clampZoomPx(px: number): number {
  return Math.min(MAX_UI_ZOOM_PX, Math.max(MIN_UI_ZOOM_PX, Math.round(px)));
}

export function readStoredUiZoomPx(): number {
  try {
    const raw = settings.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UI_ZOOM_PX;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return clampZoomPx(n);
  } catch {
    /* ignore */
  }
  return DEFAULT_UI_ZOOM_PX;
}

export function getEffectiveUiZoomPx(): number {
  if (typeof document === 'undefined') return DEFAULT_UI_ZOOM_PX;
  const inline = document.documentElement.style.fontSize;
  if (inline.endsWith('px')) {
    const n = Number.parseInt(inline, 10);
    if (Number.isFinite(n)) return clampZoomPx(n);
  }
  return readStoredUiZoomPx();
}

export function applyUiZoomPx(px: number): number {
  const next = clampZoomPx(px);
  document.documentElement.style.fontSize = `${next}px`;

  try {
    settings.setItem(STORAGE_KEY, String(next));
  } catch {
    /* ignore */
  }

  for (const listener of listeners) listener(next);
  return next;
}

export function zoomUiIn(): number {
  return applyUiZoomPx(readStoredUiZoomPx() + UI_ZOOM_STEP_PX);
}

export function zoomUiOut(): number {
  return applyUiZoomPx(readStoredUiZoomPx() - UI_ZOOM_STEP_PX);
}

export function resetUiZoom(): number {
  return applyUiZoomPx(DEFAULT_UI_ZOOM_PX);
}

export function subscribeUiZoomChanged(listener: UiZoomListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initUiZoom(): number {
  const px = readStoredUiZoomPx();
  applyUiZoomPx(px);
  return px;
}
