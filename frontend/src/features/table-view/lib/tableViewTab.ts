import type { EditorTab } from '@/types';

export function findTableViewTab(
  tabs: EditorTab[],
  connectionId: string,
  schema: string,
  table: string
): EditorTab | undefined {
  return tabs.find(
    (t) =>
      t.tableView?.schema === schema &&
      t.tableView?.table === table &&
      t.connectionId === connectionId
  );
}

export function isTableViewOpenInTabs(
  tabs: EditorTab[],
  connectionId: string,
  schema: string,
  table: string
): boolean {
  return findTableViewTab(tabs, connectionId, schema, table) != null;
}
