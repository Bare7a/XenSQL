import { settings } from '@/shared/lib/settingsStore';

// Returns a teardown so the caller can end the drag on unmount.
export function startPanelResize(
  e: React.MouseEvent,
  axis: 'x' | 'y',
  apply: (totalDelta: number) => void,
): () => void {
  e.preventDefault();
  const start = axis === 'x' ? e.clientX : e.clientY;

  const onMove = (ev: MouseEvent) => {
    const pos = axis === 'x' ? ev.clientX : ev.clientY;
    apply(pos - start);
  };

  const cleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  function onUp() {
    cleanup();
  }

  document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  return cleanup;
}

export function readStoredWidth(key: string, fallback: number, min?: number, max?: number): number {
  try {
    const v = settings.getItem(key);
    if (v == null) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    // Clamp each bound independently so passing only min (or only max) still applies.
    let clamped = n;
    if (min != null) clamped = Math.max(min, clamped);
    if (max != null) clamped = Math.min(max, clamped);
    return clamped;
  } catch {
    return fallback;
  }
}

export function storeWidth(key: string, width: number): void {
  try {
    settings.setItem(key, String(Math.round(width)));
  } catch {
    /* ignore */
  }
}
