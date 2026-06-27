import { Bookmark, Database, File, type LucideIcon, Table2 } from 'lucide-react';
import type { EditorTab } from '@/types';

export type TabKind = 'sql' | 'table' | 'saved';

export type QuickSearchKind = TabKind | 'conn';

const TAB_KIND_ICON: Record<TabKind, LucideIcon> = {
  sql: File,
  table: Table2,
  saved: Bookmark,
};

const QUICK_SEARCH_KIND_ICON: Record<QuickSearchKind, LucideIcon> = {
  ...TAB_KIND_ICON,
  conn: Database,
};

export function tabKindOf(tab: EditorTab): TabKind {
  if (tab.tableView) return 'table';
  if (tab.savedQueryId) return 'saved';
  return 'sql';
}

export function iconForEditorTab(tab: EditorTab): LucideIcon {
  return TAB_KIND_ICON[tabKindOf(tab)];
}

export function iconForQuickSearchKind(kind: QuickSearchKind): LucideIcon {
  return QUICK_SEARCH_KIND_ICON[kind];
}
