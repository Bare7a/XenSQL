// Sidebar dispatches, active SqlEditor listens - decoupled from Monaco via window event
export const INSERT_SQL_EVENT = 'xensql:insert-sql';

export interface InsertSqlDetail {
  text: string;
}

export function insertSqlIntoEditor(text: string): void {
  if (!text) return;
  window.dispatchEvent(new CustomEvent<InsertSqlDetail>(INSERT_SQL_EVENT, { detail: { text } }));
}
