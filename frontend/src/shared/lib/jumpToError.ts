import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { createEmitter } from '@/shared/lib/emitter';

export const QUERY_ERROR_MARKER_OWNER = 'xensql:query-error';

export interface JumpToErrorRequest {
  statement: string;
  position: number; // 1-based char offset within the statement
  message?: string;
}

// Results pane emits, the active SqlEditor subscribes (mirrors insertSql).
const jumpToErrorEmitter = createEmitter<JumpToErrorRequest>();

export const subscribeJumpToError = jumpToErrorEmitter.subscribe;

export function jumpToQueryError(statement: string, position: number, message?: string): void {
  if (!statement || position <= 0) return;
  jumpToErrorEmitter.emit({ statement, position, message });
}

export function clearQueryErrorMarkers(monaco: Monaco | null, model: editor.ITextModel | null): void {
  if (!monaco || !model) return;
  monaco.editor.setModelMarkers(model, QUERY_ERROR_MARKER_OWNER, []);
}
