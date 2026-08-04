import { createEmitter } from '@/shared/lib/emitter';

// Sidebar emits, the active SqlEditor subscribes - decoupled from Monaco without a window event.
const insertSqlEmitter = createEmitter<string>();

export const subscribeInsertSql = insertSqlEmitter.subscribe;

export function insertSqlIntoEditor(text: string): void {
  if (!text) return;
  insertSqlEmitter.emit(text);
}
