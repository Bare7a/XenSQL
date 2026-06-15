import { readStoredEditorFontSize } from '@/features/editor/lib/editorFontSize';

export const APP_FONT_SANS = 'Inter';
export const APP_FONT_MONO = 'Fira Code';

/** Monaco fontFamily option; must match @fontsource/fira-code and --font-mono in global.css. */
export const MONACO_FONT_FAMILY = `"${APP_FONT_MONO}", monospace`;

const FONT_LOAD_TIMEOUT_MS = 10_000;

function fontLoadSpecs(uiRootPx: number, editorFontPx: number): string[] {
  return [
    `${uiRootPx}px "${APP_FONT_SANS}"`,
    `${editorFontPx}px ${MONACO_FONT_FAMILY}`,
    `600 ${editorFontPx}px "${APP_FONT_MONO}"`,
  ];
}

/** Block boot until UI fonts are loaded so Monaco and the shell paint with correct metrics. */
export async function loadAppFonts(uiRootPx: number, editorFontPx = readStoredEditorFontSize()): Promise<void> {
  if (typeof document === 'undefined') return;

  const specs = fontLoadSpecs(uiRootPx, editorFontPx);
  const loads = Promise.all(specs.map((spec) => document.fonts.load(spec).catch(() => undefined)));

  const timeout = new Promise<void>((resolve) => {
    window.setTimeout(resolve, FONT_LOAD_TIMEOUT_MS);
  });

  await Promise.race([Promise.all([loads, document.fonts.ready]), timeout]);
}
