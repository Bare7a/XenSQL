import { IsDesktopMode } from '@bindings/xensql/internal/app/app';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform);

let desktopMode = false;

// Resolved once in bootstrap(), before the first render; browsers stay false.
export async function initPlatform(): Promise<void> {
  try {
    desktopMode = (await IsDesktopMode()) === true;
  } catch {
    desktopMode = false;
  }
}

export function isDesktop(): boolean {
  return desktopMode;
}

// mac desktop uses native chrome; Windows/Linux desktop draw the in-page bar.
export function isMacDesktop(): boolean {
  return isMac && desktopMode;
}
