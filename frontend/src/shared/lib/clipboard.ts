import { Clipboard } from '@wailsio/runtime';

/** Wails clipboard first (no permission gate); browser API as the server/dev-mode fallback. */
export async function readClipboardText(): Promise<string> {
  try {
    return await Clipboard.Text();
  } catch {
    return navigator.clipboard.readText();
  }
}
