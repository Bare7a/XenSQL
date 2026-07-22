import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor, languages, Position } from 'monaco-editor';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { MONACO_FONT_METRICS_OPTIONS } from '@/features/editor/lib/monacoFontMetrics';
import { getMonacoThemeName, setupMonacoBeforeMount } from '@/features/editor/lib/monacoTheme';
import { sqlLabels } from '@/features/editor/lib/sqlLabels';
import { formatSqlIdentifier } from '@/features/editor/lib/sqlQuoting';
import { matchScore, rank } from '@/features/editor/lib/sqlSuggestions';
import { useAppTheme } from '@/shared/hooks/useAppTheme';
import { useUiZoom } from '@/shared/hooks/useUiZoom';
import { cx } from '@/shared/lib/cx';
import type { DriverType } from '@/types';

// Bare WHERE-clause vocabulary only - no FROM/SELECT/JOIN/ORDER.
const WHERE_KEYWORDS = [
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'BETWEEN',
  'IS NULL',
  'IS NOT NULL',
  'EXISTS',
  'NULL',
  'TRUE',
  'FALSE',
] as const;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  columns: string[];
  columnTypes?: string[];
  driver: DriverType;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

const STATIC_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  ...MONACO_FONT_METRICS_OPTIONS,
  minimap: { enabled: false },
  contextmenu: false,
  glyphMargin: false,
  folding: false,
  lineNumbers: 'off',
  lineNumbersMinChars: 0,
  renderLineHighlight: 'none',
  scrollBeyondLastLine: false,
  scrollBeyondLastColumn: 0,
  wordWrap: 'off',
  automaticLayout: true,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    vertical: 'hidden',
    horizontal: 'hidden',
    handleMouseWheel: false,
    alwaysConsumeMouseWheel: false,
    verticalScrollbarSize: 0,
    horizontalScrollbarSize: 0,
  },
  suggestOnTriggerCharacters: true,
  quickSuggestions: { other: true, strings: false, comments: false },
  // 'on': Enter accepts suggestion when widget is open; the keydown handler submits when it's closed.
  acceptSuggestionOnEnter: 'on',
  fixedOverflowWidgets: true,
  find: { addExtraSpaceOnTop: false, autoFindInSelection: 'never', seedSearchStringFromSelection: 'never' },
  guides: { indentation: false },
  occurrencesHighlight: 'off',
  matchBrackets: 'never',
  selectionHighlight: false,
  links: false,
};

// Wrapper height is 2.154rem; ratios anchor to 13px UI zoom (fontSize=0.923rem, lineDecorationsWidth=0.769rem).
function sizingOptions(uiZoomPx: number): {
  fontSize: number;
  lineHeight: number;
  padding: { top: number; bottom: number };
  lineDecorationsWidth: number;
} {
  const wrapperInner = Math.max(0, 2.154 * uiZoomPx - 2);
  const padding = Math.max(2, Math.round(uiZoomPx * 0.3));
  const lineHeight = Math.max(12, Math.floor(wrapperInner - 2 * padding));
  const fontSize = Math.round(uiZoomPx * 0.923);
  const lineDecorationsWidth = Math.round(uiZoomPx * 0.769);
  return {
    fontSize,
    lineHeight,
    padding: { top: padding, bottom: padding },
    lineDecorationsWidth,
  };
}

export function SqlConditionInput({
  value,
  onChange,
  onSubmit,
  columns,
  columnTypes,
  driver,
  placeholder,
  className,
  ariaLabel,
}: Props) {
  const appTheme = useAppTheme();
  const monacoTheme = getMonacoThemeName(appTheme);
  const uiZoomPx = useUiZoom();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const completionProviderRef = useRef<{ dispose: () => void } | null>(null);

  // Ref keeps completion provider fresh without re-registration on every render.
  const ctxRef = useRef({ columns, columnTypes, driver });
  ctxRef.current = { columns, columnTypes, driver };

  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (ed.getValue() !== value) {
      ed.setValue(value);
    }
  }, [value]);

  const handleMount = useCallback((ed: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;

    // onKeyDown is instance-scoped; addCommand(Enter) leaks to other Monaco editors via the shared keybinding service.
    ed.onKeyDown((e) => {
      if (e.keyCode !== monaco.KeyCode.Enter) return;
      // If the suggest widget is visible, let Monaco accept the suggestion.
      const root = ed.getDomNode();
      const suggestVisible = !!root?.querySelector?.('.suggest-widget.visible');
      if (suggestVisible && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) return;
      e.preventDefault();
      if (!(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
        onSubmitRef.current?.();
      }
    });

    ed.onDidChangeModelContent(() => {
      const v = ed.getValue();
      if (v.includes('\n') || v.includes('\r')) {
        // Flatten newlines from pastes - this is a single-line input.
        const flat = v.replace(/[\r\n]+/g, ' ');
        ed.setValue(flat);
        onChangeRef.current(flat);
        return;
      }
      onChangeRef.current(v);
    });

    completionProviderRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', ' ', '=', '<', '>', '!'],
      provideCompletionItems: (model: editor.ITextModel, position: Position) => {
        // Bail out for other editors' models - SqlEditor registers a second 'sql' provider and both fire for every sql model.
        if (model !== ed.getModel()) return { suggestions: [] };

        const Kind = monaco.languages.CompletionItemKind;
        const word = model.getWordUntilPosition(position);
        const lcPrefix = word.word.toLowerCase();
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const { columns: cols, columnTypes: types, driver: drv } = ctxRef.current;
        const suggestions: languages.CompletionItem[] = [];

        cols.forEach((col, i) => {
          const score = matchScore(col, lcPrefix);
          if (score < 0) return;
          suggestions.push({
            label: col,
            kind: Kind.Field,
            detail: types?.[i] || sqlLabels().column,
            insertText: formatSqlIdentifier(col, drv),
            sortText: rank(0, score, col),
            range,
          });
        });

        for (const kw of WHERE_KEYWORDS) {
          const score = matchScore(kw, lcPrefix);
          if (score < 0) continue;
          suggestions.push({
            label: kw,
            kind: Kind.Keyword,
            insertText: kw,
            sortText: rank(1, score, kw),
            range,
          });
        }

        return { suggestions };
      },
    });
  }, []);

  useEffect(() => {
    return () => {
      completionProviderRef.current?.dispose();
      completionProviderRef.current = null;
    };
  }, []);

  const options = useMemo(() => ({ ...STATIC_OPTIONS, ...sizingOptions(uiZoomPx), ariaLabel }), [uiZoomPx, ariaLabel]);

  useEffect(() => {
    editorRef.current?.updateOptions({ ...MONACO_FONT_METRICS_OPTIONS, ...sizingOptions(uiZoomPx) });
  }, [uiZoomPx]);

  const showPlaceholder = !value && !!placeholder;

  return (
    <div className={cx('sql-condition-input', className)}>
      <Editor
        height="100%"
        language="sql"
        theme={monacoTheme}
        defaultValue={value}
        beforeMount={setupMonacoBeforeMount}
        onMount={handleMount}
        options={options}
        loading={<div className="monaco-editor-placeholder" aria-hidden />}
      />
      {showPlaceholder && (
        <div className="sql-condition-input-placeholder" aria-hidden>
          {placeholder}
        </div>
      )}
    </div>
  );
}
