import { Clipboard } from '@wailsio/runtime';
import { isDesktop } from '@/shared/lib/platform';

/** Wails clipboard on desktop (no permission gate); navigator otherwise - the runtime hits the server's clipboard. */
export async function readClipboardText(): Promise<string> {
  if (isDesktop()) return Clipboard.Text();
  return navigator.clipboard.readText();
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isDesktop()) return Clipboard.SetText(text);
  return navigator.clipboard.writeText(text);
}
