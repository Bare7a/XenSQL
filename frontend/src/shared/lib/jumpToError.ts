import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

// Results pane dispatches, the active SqlEditor listens (mirrors INSERT_SQL_EVENT).
export const JUMP_TO_ERROR_EVENT = 'xensql:jump-to-error';

export const QUERY_ERROR_MARKER_OWNER = 'xensql:query-error';

export interface JumpToErrorDetail {
  statement: string;
  position: number; // 1-based char offset within the statement
  message?: string;
}

export function jumpToQueryError(statement: string, position: number, message?: string): void {
  if (!statement || position <= 0) return;
  window.dispatchEvent(
    new CustomEvent<JumpToErrorDetail>(JUMP_TO_ERROR_EVENT, { detail: { statement, position, message } }),
  );
}

export function clearQueryErrorMarkers(monaco: Monaco | null, model: editor.ITextModel | null): void {
  if (!monaco || !model) return;
  monaco.editor.setModelMarkers(model, QUERY_ERROR_MARKER_OWNER, []);
}
