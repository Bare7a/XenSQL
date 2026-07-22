// Bare editor API + only the languages/features we use. Importing `monaco-editor` would
// pull in every language service/worker (TypeScript, CSS, …) even with the getWorker guard.

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController'; // autocomplete widget
import 'monaco-editor/features/hover/register'; // SQL hover provider UI
import 'monaco-editor/features/find/register'; // Find / Find & Replace (context menu)
import 'monaco-editor/features/folding/register'; // JSON / cell viewer folding
import { remeasureMonacoFonts } from '@/features/editor/lib/monacoFontMetrics';
import 'monaco-editor/languages/features/json/register'; // RowJsonViewer + cell JSON (worker)
import 'monaco-editor/languages/definitions/sql/register'; // SQL highlighting
import 'monaco-editor/languages/definitions/xml/register'; // cell viewer
import 'monaco-editor/languages/definitions/html/register'; // cell viewer
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';

// Local bundle for @monaco-editor/react (no CDN) — editor worker + JSON worker only.
export function initMonaco(): void {
  remeasureMonacoFonts();

  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === 'json') return new jsonWorker();
      return new editorWorker();
    },
  };
  loader.config({ monaco });
}
