import { useEffect, type RefObject } from 'react';
import type { editor } from 'monaco-editor';
import type { EditorCursorState } from '@/types';

export function useCursorPersistence(
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>,
  cursorStateRef: RefObject<EditorCursorState | undefined>,
  isActive: boolean,
  tabId: string
) {
  useEffect(() => {
    if (!isActive) return;
    const ed = editorRef.current;
    if (!ed) return;

    requestAnimationFrame(() => {
      ed.focus();
      const cs = cursorStateRef.current;
      if (cs) {
        ed.setPosition({
          lineNumber: cs.lineNumber,
          column: cs.column,
        });
        if (cs.scrollTop != null) {
          ed.setScrollTop(cs.scrollTop);
        }
      } else {
        ed.setPosition({ lineNumber: 1, column: 1 });
        ed.setScrollTop(0);
      }
    });
  }, [isActive, tabId, editorRef, cursorStateRef]);
}
