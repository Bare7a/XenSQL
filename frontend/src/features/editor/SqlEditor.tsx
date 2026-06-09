import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorToolbar } from '@/features/editor/EditorToolbar';
import { useCursorPersistence } from '@/features/editor/hooks/useCursorPersistence';
import { useEditorActions } from '@/features/editor/hooks/useEditorActions';
import { useEditorContextMenu } from '@/features/editor/hooks/useEditorContextMenu';
import { useEditorFontSize } from '@/features/editor/hooks/useEditorFontSize';
import { useRunGlyphs } from '@/features/editor/hooks/useRunGlyphs';
import { useSidebarInsert } from '@/features/editor/hooks/useSidebarInsert';
import { createSqlCompletionProvider } from '@/features/editor/lib/createSqlCompletionProvider';
import { monacoFontOptions } from '@/features/editor/lib/editorFontSize';
import { getMonacoThemeName, setupMonacoBeforeMount } from '@/features/editor/lib/monacoTheme';
import { findStatementAtRunLine } from '@/features/editor/lib/sqlStatements';
import { subscribeLanguageChanged } from '@/i18n';
import { ContextMenu } from '@/shared/components/ContextMenu';
import { useAppTheme } from '@/shared/hooks/useAppTheme';
import { subscribeShortcutsChanged } from '@/shared/lib/shortcuts';
import type { ColumnInfo, DriverType, EditorCursorState, SchemaInfo, TableInfo, TxnState } from '@/types';

const STATIC_EDITOR_OPTIONS = {
  fontFamily: 'JetBrains Mono, Consolas, monospace',
  minimap: { enabled: false },
  contextmenu: false,
  wordWrap: 'on' as const,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  lineNumbers: 'on' as const,
  glyphMargin: true,
  lineDecorationsWidth: 0,
  lineNumbersMinChars: 3,
  renderLineHighlight: 'line' as const,
  selectOnLineNumbers: false,
  padding: { top: 12, bottom: 12 },
  suggestOnTriggerCharacters: true,
  // No auto-popup inside string literals - suggesting identifiers there is just noise.
  quickSuggestions: { other: true, strings: false },
  // Our provider is schema-aware; Monaco's word-based suggestions only add noisy document tokens.
  wordBasedSuggestions: 'off' as const,
  fixedOverflowWidgets: true,
  find: { addExtraSpaceOnTop: false },
};

interface Props {
  tabId: string;
  connectionId: string;
  driver: DriverType;
  sql: string;
  color: string;
  isActive: boolean;
  cursorState?: EditorCursorState;
  onCursorStateChange?: (state: EditorCursorState) => void;
  onChange: (sql: string) => void;
  onRun: (sql: string) => void;
  isQueryRunning?: boolean;
  onCancelQuery?: () => void;
  onSaveQuery?: () => void;
  onRenameSavedQuery?: () => void;
  savedQueryId?: string;
  savedQueryName?: string;
  isSavedQueryDirty?: boolean;
  txnState?: TxnState;
  onBeginTxn?: () => void;
  onCommitTxn?: () => void;
  onRollbackTxn?: () => void;
  schemas: SchemaInfo[];
  allTables: TableInfo[];
  onLoadColumns: (schema: string, table: string) => Promise<ColumnInfo[]>;
}

// Memoized so typing in the active tab doesn't re-render the other mounted (hidden) editors.
export const SqlEditor = memo(function SqlEditor({
  tabId,
  connectionId,
  driver,
  sql,
  isActive,
  cursorState,
  onCursorStateChange,
  onChange,
  onRun,
  isQueryRunning = false,
  onCancelQuery,
  onSaveQuery,
  onRenameSavedQuery,
  savedQueryId,
  savedQueryName,
  isSavedQueryDirty,
  txnState,
  onBeginTxn,
  onCommitTxn,
  onRollbackTxn,
  schemas,
  allTables,
  onLoadColumns,
}: Props) {
  const appTheme = useAppTheme();
  const monacoTheme = getMonacoThemeName(appTheme);
  const fontSize = useEditorFontSize();
  const editorOptions = useMemo(() => ({ ...STATIC_EDITOR_OPTIONS, ...monacoFontOptions(fontSize) }), [fontSize]);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState(300);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const completionProviderRef = useRef<{ dispose: () => void } | null>(null);
  const contextMenuCleanupRef = useRef<(() => void) | null>(null);
  const isQueryRunningRef = useRef(isQueryRunning);
  const onRunRef = useRef(onRun);
  const [shortcutRevision, setShortcutRevision] = useState(0);
  const [languageRevision, setLanguageRevision] = useState(0);
  // Mirrors backend DefaultBrowseSchema: postgres/sqlite → 'public', mysql → '' (uses database, not schema).
  const tablesBySchema = useMemo<Record<string, TableInfo[]>>(() => {
    const defaultKey = driver === 'postgres' ? 'public' : driver === 'mysql' ? '' : 'public';
    const grouped: Record<string, TableInfo[]> = {};
    for (const table of allTables) {
      const key = table.schema || defaultKey;
      grouped[key] ||= [];
      grouped[key].push(table);
    }
    return grouped;
  }, [allTables, driver]);

  const completionCtxRef = useRef({
    schemas,
    allTables,
    tablesBySchema,
    onLoadColumns,
    connectionId,
    driver,
  });
  completionCtxRef.current = { schemas, allTables, tablesBySchema, onLoadColumns, connectionId, driver };
  const onSaveQueryRef = useRef(onSaveQuery);
  const onRenameSavedQueryRef = useRef(onRenameSavedQuery);
  const onCursorStateChangeRef = useRef(onCursorStateChange);
  const cursorStateRef = useRef(cursorState);
  onSaveQueryRef.current = onSaveQuery;
  onRenameSavedQueryRef.current = onRenameSavedQuery;
  onCursorStateChangeRef.current = onCursorStateChange;
  cursorStateRef.current = cursorState;
  isQueryRunningRef.current = isQueryRunning;
  onRunRef.current = onRun;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const height = el.clientHeight;
      if (height > 0) setEditorHeight(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tabId]);

  const runQuery = useCallback(
    (selectedOnly: boolean) => {
      if (isQueryRunning) return;
      const ed = editorRef.current;
      if (!ed) return;
      let text: string;
      if (selectedOnly) {
        const selection = ed.getSelection();
        const sel = (selection ? ed.getModel()?.getValueInRange(selection) : '') || '';
        if (!sel.trim()) return;
        text = sel;
      } else {
        text = ed.getValue();
      }
      if (text.trim()) onRun(text);
    },
    [onRun, isQueryRunning],
  );

  const runStatement = useCallback((text: string) => {
    if (isQueryRunningRef.current) return;
    const trimmed = text.trim();
    if (trimmed) onRunRef.current(trimmed);
  }, []);

  const { updateRunGlyphs, statementsRef } = useRunGlyphs(editorRef, monacoRef, sql, languageRevision);

  const { bindEditorActions } = useEditorActions({
    editorRef,
    monacoRef,
    isActive,
    runQuery,
    onSaveQueryRef,
    onRenameSavedQueryRef,
    shortcutRevision,
    languageRevision,
  });

  useEffect(() => subscribeShortcutsChanged(() => setShortcutRevision((n) => n + 1)), []);

  useEffect(() => {
    editorRef.current?.updateOptions(monacoFontOptions(fontSize));
  }, [fontSize]);
  useEffect(() => subscribeLanguageChanged(() => setLanguageRevision((n) => n + 1)), []);

  const registerCompletionProvider = useCallback(() => {
    if (!isActive) return;

    const monaco = monacoRef.current;
    const ed = editorRef.current;
    if (!monaco || !ed) return;

    completionProviderRef.current?.dispose();
    completionProviderRef.current = monaco.languages.registerCompletionItemProvider(
      'sql',
      createSqlCompletionProvider(monaco, ed, () => {
        const {
          schemas: s,
          allTables: at,
          tablesBySchema: tbs,
          onLoadColumns: loadCols,
          driver: drv,
        } = completionCtxRef.current;
        return { schemas: s, allTables: at, tablesBySchema: tbs, onLoadColumns: loadCols, driver: drv };
      }),
    );
  }, [isActive]);

  const handleEditorMount = (ed: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = ed;

    if (cursorState) {
      ed.setPosition({
        lineNumber: cursorState.lineNumber,
        column: cursorState.column,
      });
      if (cursorState.scrollTop != null) {
        ed.setScrollTop(cursorState.scrollTop);
      }
    }

    ed.onDidChangeCursorPosition(() => {
      const pos = ed.getPosition();
      if (!pos) return;
      onCursorStateChangeRef.current?.({
        lineNumber: pos.lineNumber,
        column: pos.column,
        scrollTop: ed.getScrollTop(),
      });
    });

    ed.onDidScrollChange(() => {
      const pos = ed.getPosition();
      if (!pos) return;
      onCursorStateChangeRef.current?.({
        lineNumber: pos.lineNumber,
        column: pos.column,
        scrollTop: ed.getScrollTop(),
      });
    });

    if (isActive) {
      requestAnimationFrame(() => {
        ed.focus();
      });
    }

    bindEditorActions(ed, monaco);

    updateRunGlyphs(ed, monaco, sql);

    ed.onMouseDown((e) => {
      const monacoInstance = monacoRef.current;
      if (!monacoInstance) return;
      if (e.target.type !== monacoInstance.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      if (isQueryRunningRef.current) return;
      const line = e.target.position?.lineNumber;
      if (!line) return;
      const stmts = statementsRef.current;
      // A line can hold several statements; prefer the one the cursor sits in, else the first on the line.
      let stmt = findStatementAtRunLine(stmts, line);
      const model = ed.getModel();
      const pos = ed.getPosition();
      if (model && pos && pos.lineNumber === line) {
        const off = model.getOffsetAt(pos);
        const atCursor = stmts.find((s) => s.runLine === line && off >= s.start && off < s.end);
        if (atCursor) stmt = atCursor;
      }
      if (!stmt) return;
      e.event.preventDefault();
      e.event.stopPropagation();
      runStatement(stmt.text);
    });

    monacoRef.current = monaco;
    registerCompletionProvider();

    const domNode = ed.getDomNode();
    if (domNode) {
      const onContextMenu = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        setContextMenu({ x: ev.clientX, y: ev.clientY });
      };
      domNode.addEventListener('contextmenu', onContextMenu);
      contextMenuCleanupRef.current = () => domNode.removeEventListener('contextmenu', onContextMenu);
    }
  };

  useEffect(() => {
    if (!isActive) {
      completionProviderRef.current?.dispose();
      completionProviderRef.current = null;
      return;
    }
    registerCompletionProvider();
    return () => {
      completionProviderRef.current?.dispose();
      completionProviderRef.current = null;
    };
    // Provider reads schemas/tables live via completionCtxRef, so it needn't re-register when they
    // change - listing `allTables` here re-registered it on every keystroke.
  }, [isActive, tabId, registerCompletionProvider]);

  // Drop the onMount contextmenu listener on unmount.
  useEffect(() => () => contextMenuCleanupRef.current?.(), []);

  useSidebarInsert(editorRef, isActive);

  useCursorPersistence(editorRef, cursorStateRef, isActive, tabId);

  const contextItems = useEditorContextMenu(editorRef, sql, onChange);

  return (
    <div className="sql-editor-root">
      <EditorToolbar
        isQueryRunning={isQueryRunning}
        onCancelQuery={onCancelQuery}
        runQuery={runQuery}
        onSaveQuery={onSaveQuery}
        onRenameSavedQuery={onRenameSavedQuery}
        savedQueryId={savedQueryId}
        savedQueryName={savedQueryName}
        isSavedQueryDirty={isSavedQueryDirty}
        txnState={txnState}
        onBeginTxn={onBeginTxn}
        onCommitTxn={onCommitTxn}
        onRollbackTxn={onRollbackTxn}
      />
      <div ref={containerRef} className={`editor-pane${isQueryRunning ? ' editor-pane-query-running' : ''}`}>
        <Editor
          height={editorHeight}
          path={`${tabId}.sql`}
          language="sql"
          theme={monacoTheme}
          value={sql}
          loading={<div className="monaco-editor-placeholder" aria-hidden />}
          onChange={(v) => onChange(v || '')}
          beforeMount={setupMonacoBeforeMount}
          onMount={handleEditorMount}
          options={editorOptions}
        />
      </div>
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextItems} onClose={() => setContextMenu(null)} />
      )}
    </div>
  );
});
