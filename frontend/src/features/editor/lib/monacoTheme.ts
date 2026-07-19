import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { AppTheme } from '@/shared/lib/theme';

const XENSQL_MONACO_THEME_DARK = 'xensql-dark';
const XENSQL_MONACO_THEME_LIGHT = 'xensql-light';

const DARK_SQL_KEYWORD = '569CD6';
const LIGHT_SQL_KEYWORD = '0000FF';
const DARK_SQL_STRING = 'E6DB74';
const LIGHT_SQL_STRING = '7A6E2A';

// Must include *.sql token variants - vs-dark's built-in predefined.sql/string.sql override plain predefined/string.
const sqlSyntaxRules = (keyword: string, stringColor: string) => [
  { token: 'keyword', foreground: keyword },
  { token: 'keyword.block', foreground: keyword },
  { token: 'keyword.choice', foreground: keyword },
  { token: 'keyword.try', foreground: keyword },
  { token: 'keyword.catch', foreground: keyword },
  { token: 'predefined', foreground: keyword },
  { token: 'predefined.sql', foreground: keyword },
  { token: 'string', foreground: stringColor },
  { token: 'string.sql', foreground: stringColor },
  { token: 'number', foreground: 'B5CEA8' },
  { token: 'number.sql', foreground: 'B5CEA8' },
  { token: 'comment', foreground: '6A9955', fontStyle: 'italic' as const },
  { token: 'operator', foreground: keyword },
  { token: 'operator.sql', foreground: keyword },
  { token: 'identifier', foreground: 'D4D4D4' },
  { token: 'delimiter', foreground: 'ABB2BF' },
  { token: 'delimiter.sql', foreground: 'ABB2BF' },
];

const sqlSyntaxRulesLight = (keyword: string, stringColor: string) => [
  { token: 'keyword', foreground: keyword },
  { token: 'keyword.block', foreground: keyword },
  { token: 'keyword.choice', foreground: keyword },
  { token: 'keyword.try', foreground: keyword },
  { token: 'keyword.catch', foreground: keyword },
  { token: 'predefined', foreground: keyword },
  { token: 'predefined.sql', foreground: keyword },
  { token: 'string', foreground: stringColor },
  { token: 'string.sql', foreground: stringColor },
  { token: 'number', foreground: '098658' },
  { token: 'comment', foreground: '008000', fontStyle: 'italic' as const },
  { token: 'operator', foreground: keyword },
  { token: 'operator.sql', foreground: keyword },
  { token: 'identifier', foreground: '1f2328' },
  { token: 'delimiter', foreground: '393A34' },
];

const darkEditorColors = {
  'editor.background': '#0f1117',
  'editor.foreground': '#e6edf3',
  'editor.lineHighlightBackground': '#161b2288',
  'editorLineNumber.foreground': '#6e7681',
  'editorLineNumber.activeForeground': '#c9d1d9',
  'editor.selectionBackground': '#3b82f644',
  'editor.inactiveSelectionBackground': '#3b82f622',
  'editorIndentGuide.background': '#21262d',
  'editorIndentGuide.activeBackground': '#373e47',
  'editor.foldBackground': '#1c2128aa',
  'editorWidget.background': '#161b22',
  'editorGutter.background': '#0f1117',
  'editorHoverWidget.background': '#161b22',
  'editorHoverWidget.foreground': '#e6edf3',
  'editorHoverWidget.border': '#30363d',
};

const lightEditorColors = {
  'editor.background': '#ffffff',
  'editor.foreground': '#1f2328',
  'editor.lineHighlightBackground': '#f6f8fa',
  'editorLineNumber.foreground': '#8c959f',
  'editorLineNumber.activeForeground': '#1f2328',
  'editor.selectionBackground': '#0969da33',
  'editor.inactiveSelectionBackground': '#0969da18',
  'editorIndentGuide.background': '#d8dee4',
  'editorIndentGuide.activeBackground': '#afb8c1',
  'editor.foldBackground': '#f6f8faaa',
  'editorWidget.background': '#ffffff',
  'editorGutter.background': '#ffffff',
  'editorHoverWidget.background': '#ffffff',
  'editorHoverWidget.foreground': '#1f2328',
  'editorHoverWidget.border': '#d0d7de',
};

export function getMonacoThemeName(theme: AppTheme): string {
  return theme === 'light' ? XENSQL_MONACO_THEME_LIGHT : XENSQL_MONACO_THEME_DARK;
}

/** Apply theme, layout and re-tokenize after mount or when a panel becomes visible. */
export function syncMonacoEditorView(ed: editor.IStandaloneCodeEditor, theme: string): void {
  requestAnimationFrame(() => {
    monaco.editor.setTheme(theme);
    ed.layout();
    const model = ed.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, model.getLanguageId());
    }
  });
}

function ensureXenSqlMonacoThemes(monaco: Monaco): void {
  monaco.editor.defineTheme(XENSQL_MONACO_THEME_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: '9CDCFE' },
      { token: 'string.value.json', foreground: 'CE9178' },
      { token: 'number.json', foreground: 'B5CEA8' },
      { token: 'keyword.json', foreground: '569CD6' },
      { token: 'keyword.xml', foreground: DARK_SQL_KEYWORD },
      { token: 'tag', foreground: '569CD6' },
      { token: 'tag.html', foreground: '569CD6' },
      { token: 'attribute.name', foreground: '9CDCFE' },
      { token: 'attribute.value', foreground: DARK_SQL_STRING },
      { token: 'delimiter.xml', foreground: 'ABB2BF' },
      { token: 'metatag', foreground: '569CD6' },
      ...sqlSyntaxRules(DARK_SQL_KEYWORD, DARK_SQL_STRING),
    ],
    colors: darkEditorColors,
  });

  monaco.editor.defineTheme(XENSQL_MONACO_THEME_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: '795E26' },
      { token: 'string.value.json', foreground: LIGHT_SQL_STRING },
      { token: 'keyword.json', foreground: '0451A5' },
      { token: 'keyword.xml', foreground: LIGHT_SQL_KEYWORD },
      { token: 'tag', foreground: '800000' },
      { token: 'tag.html', foreground: '800000' },
      { token: 'attribute.name', foreground: 'E06C00' },
      { token: 'attribute.value', foreground: LIGHT_SQL_STRING },
      { token: 'delimiter.xml', foreground: '393A34' },
      { token: 'metatag', foreground: '0451A5' },
      ...sqlSyntaxRulesLight(LIGHT_SQL_KEYWORD, LIGHT_SQL_STRING),
    ],
    colors: lightEditorColors,
  });
}

// Must be called from Editor beforeMount so themes share the same Monaco bundle.
export function setupMonacoBeforeMount(monaco: Monaco): void {
  ensureXenSqlMonacoThemes(monaco);
}
