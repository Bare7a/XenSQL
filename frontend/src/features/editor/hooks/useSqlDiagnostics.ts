import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { type RefObject, useEffect } from 'react';
import { collectSchemaDiagnostics } from '@/features/editor/lib/sqlDiagnostics';
import type { DriverType, SchemaInfo, TableInfo } from '@/types';

const SCHEMA_MARKER_OWNER = 'xensql-schema';

// Warns on unknown table names; the ref under the caret is skipped so typing doesn't flicker.
export function useSqlDiagnostics(
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>,
  monacoRef: RefObject<Monaco | null>,
  sql: string,
  tables: TableInfo[],
  schemas: SchemaInfo[],
  driver: DriverType,
) {
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    const model = ed?.getModel();
    if (!ed || !monaco || !model) return;

    const handle = setTimeout(() => {
      if (model.isDisposed()) return;
      const cursor = ed.getPosition();
      const cursorOffset = cursor ? model.getOffsetAt(cursor) : -1;
      const markers = collectSchemaDiagnostics(sql, tables, schemas, driver)
        .filter((d) => cursorOffset < d.start || cursorOffset > d.end)
        .map((d) => {
          const s = model.getPositionAt(d.start);
          const e = model.getPositionAt(d.end);
          return {
            severity: monaco.MarkerSeverity.Warning,
            message: d.message,
            startLineNumber: s.lineNumber,
            startColumn: s.column,
            endLineNumber: e.lineNumber,
            endColumn: e.column,
          };
        });
      monaco.editor.setModelMarkers(model, SCHEMA_MARKER_OWNER, markers);
    }, 300);

    return () => {
      clearTimeout(handle);
      if (!model.isDisposed()) monaco.editor.setModelMarkers(model, SCHEMA_MARKER_OWNER, []);
    };
  }, [editorRef, monacoRef, sql, tables, schemas, driver]);
}
