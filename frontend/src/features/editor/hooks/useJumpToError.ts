import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { type RefObject, useEffect } from 'react';
import { clearQueryErrorMarkers, QUERY_ERROR_MARKER_OWNER, subscribeJumpToError } from '@/shared/lib/jumpToError';

// Active editor only (mirrors useSidebarInsert). SplitStatements trims each statement, so it's a
// verbatim substring of the buffer and indexOf maps the error position to an absolute offset.
export function useJumpToError(
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>,
  monacoRef: RefObject<Monaco | null>,
  isActive: boolean,
  sql: string,
) {
  useEffect(() => {
    if (!isActive) return;
    return subscribeJumpToError((request) => {
      const ed = editorRef.current;
      const monaco = monacoRef.current;
      const model = ed?.getModel();
      if (!ed || !monaco || !model) return;

      const stmtStart = model.getValue().indexOf(request.statement);
      ed.focus();
      if (stmtStart < 0) return; // statement was edited away
      const pos = model.getPositionAt(stmtStart + request.position - 1);
      ed.setPosition(pos);
      ed.revealPositionInCenter(pos);

      // Squiggle the flagged token (whole word if any, else one char).
      const word = model.getWordAtPosition(pos);
      monaco.editor.setModelMarkers(model, QUERY_ERROR_MARKER_OWNER, [
        {
          severity: monaco.MarkerSeverity.Error,
          message: request.message ?? '',
          startLineNumber: pos.lineNumber,
          startColumn: word ? word.startColumn : pos.column,
          endLineNumber: pos.lineNumber,
          endColumn: word ? word.endColumn : pos.column + 1,
        },
      ]);
    });
  }, [isActive, editorRef, monacoRef]);

  // Clear the squiggle when the user edits (sql is the controlled value).
  useEffect(() => {
    clearQueryErrorMarkers(monacoRef.current, editorRef.current?.getModel() ?? null);
  }, [sql, editorRef, monacoRef]);
}
