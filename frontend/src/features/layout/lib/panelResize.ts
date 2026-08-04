import { settings } from '@/shared/lib/settingsStore';

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
