import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { MONACO_FONT_FAMILY } from '@/shared/lib/appFonts';

export const MONACO_FONT_METRICS_OPTIONS = {
  fontFamily: MONACO_FONT_FAMILY,
} as const;

/** Clear Monaco's font cache after app fonts have finished loading at boot. */
export function remeasureMonacoFonts(): void {
  monaco.editor.remeasureFonts();
}
