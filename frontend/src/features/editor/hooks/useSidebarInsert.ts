import type { editor } from 'monaco-editor';
import { type RefObject, useEffect } from 'react';
import { subscribeInsertSql } from '@/shared/lib/insertSql';

// Only the active editor subscribes so sidebar inserts land in the visible tab.
export function useSidebarInsert(editorRef: RefObject<editor.IStandaloneCodeEditor | null>, isActive: boolean) {
  useEffect(() => {
    if (!isActive) return;
    return subscribeInsertSql((text) => {
      const ed = editorRef.current;
      if (!ed) return;
      const selection = ed.getSelection();
      if (selection) {
        ed.executeEdits('insert-from-sidebar', [{ range: selection, text, forceMoveMarkers: true }]);
      }
      ed.focus();
    });
  }, [isActive, editorRef]);
}
