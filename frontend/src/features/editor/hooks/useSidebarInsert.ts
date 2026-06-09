import type { editor } from 'monaco-editor';
import { type RefObject, useEffect } from 'react';
import { INSERT_SQL_EVENT, type InsertSqlDetail } from '@/shared/lib/insertSql';

// Only the active editor listens so sidebar inserts land in the visible tab.
export function useSidebarInsert(editorRef: RefObject<editor.IStandaloneCodeEditor | null>, isActive: boolean) {
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: Event) => {
      const ed = editorRef.current;
      if (!ed) return;
      const text = (e as CustomEvent<InsertSqlDetail>).detail?.text;
      if (!text) return;
      const selection = ed.getSelection();
      if (selection) {
        ed.executeEdits('insert-from-sidebar', [{ range: selection, text, forceMoveMarkers: true }]);
      }
      ed.focus();
    };
    window.addEventListener(INSERT_SQL_EVENT, handler);
    return () => window.removeEventListener(INSERT_SQL_EVENT, handler);
  }, [isActive, editorRef]);
}
