// Import the bare editor API, NOT the full 'monaco-editor' - the full entry statically
// registers every language service (TypeScript/CSS/HTML/JSON), which makes the bundler emit
// all their (large) workers regardless of the getWorker guard below. We register only the
// languages the app actually uses.

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { remeasureMonacoFonts } from '@/features/editor/lib/monacoFontMetrics';
// JSON language service (needs a worker) - used by the row/cell JSON viewers.
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
// Syntax-highlighting-only languages (no worker): SQL editor/filter + cell viewer (xml/html).
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

// Bundle Monaco and its workers locally and hand the instance to @monaco-editor/react,
// so the editor never fetches from a CDN - the app works fully offline. Only the base
// editor worker and JSON worker are bundled; the app uses SQL (custom) + JSON + plaintext,
// plus xml/html highlighting in the cell viewer - never the TypeScript/CSS/HTML language
// services, so their (large) workers stay out of the bundle.
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
