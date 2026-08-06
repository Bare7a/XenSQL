import {
  Bookmark,
  Columns3,
  Database,
  File,
  FolderOpen,
  FunctionSquare,
  Hash,
  KeyRound,
  type LucideIcon,
  Table2,
  View,
  Zap,
} from 'lucide-react';
import type { EditorTab, ObjectKind, TableInfo } from '@/types';

export type IconKind = ObjectKind | 'schema' | 'column' | 'connection' | 'query' | 'savedQuery';

// The single source of truth for object icons: the tree, Quick Search and the editor tabs all
// resolve through it.
const ICONS: Record<IconKind, LucideIcon> = {
  table: Table2,
  view: View,
  'materialized view': View,
  index: Hash,
  constraint: KeyRound,
  trigger: Zap,
  function: FunctionSquare,
  procedure: FunctionSquare,
  schema: FolderOpen,
  column: Columns3,
  connection: Database,
  query: File,
  savedQuery: Bookmark,
};

export function iconFor(kind: IconKind | string | undefined | null): LucideIcon {
  return (kind && ICONS[kind as IconKind]) || Table2;
}

export function isViewKind(kind: ObjectKind | string | undefined): boolean {
  return kind === 'view' || kind === 'materialized view';
}

// Resolved from the loaded schema rather than the tab, which persists only schema and table.
// Undefined until those tables load; callers fall back to a table.
export function relationKindOf(tables: Record<string, TableInfo[]>, tab: EditorTab): ObjectKind | undefined {
  if (!tab.tableView) return undefined;
  const list = tables[`${tab.connectionId}:${tab.tableView.schema}`];
  return list?.find((t) => t.name === tab.tableView?.table)?.type as ObjectKind | undefined;
}

export function iconForEditorTab(tab: EditorTab, relationKind?: ObjectKind): LucideIcon {
  if (tab.tableView) return iconFor(relationKind ?? 'table');
  if (tab.savedQueryId) return iconFor('savedQuery');
  return iconFor('query');
}
