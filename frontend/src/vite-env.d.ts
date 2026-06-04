/// <reference types="vite/client" />

// Monaco ships no .d.ts for its deep ESM subpaths (we import them directly to keep
// unused language services/workers out of the bundle - see features/editor/lib/monacoSetup.ts).
// Vite resolves the real files at build time; these just satisfy tsc.
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor';
}
declare module 'monaco-editor/esm/vs/language/json/monaco.contribution';
declare module 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
declare module 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution';
declare module 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
