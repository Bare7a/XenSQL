import { Bookmark, Database, File, Table2 } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { iconForEditorTab, iconForQuickSearchKind, tabKindOf } from '@/features/editor/lib/tabKindIcon';
import type { EditorTab } from '@/types';

function tab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'tab-1',
    connectionId: 'conn-1',
    title: 'Query 1',
    sql: 'SELECT 1',
    color: '#abc',
    ...overrides,
  };
}

describe('tabKindOf', () => {
  it('returns sql for a plain editor tab', () => {
    expect(tabKindOf(tab())).toBe('sql');
  });

  it('returns table when tableView is set', () => {
    expect(tabKindOf(tab({ tableView: { schema: 'public', table: 'users' } }))).toBe('table');
  });

  it('returns saved when savedQueryId is set', () => {
    expect(tabKindOf(tab({ savedQueryId: 'sq-1' }))).toBe('saved');
  });

  it('prefers table over saved when both are present', () => {
    expect(
      tabKindOf(
        tab({
          savedQueryId: 'sq-1',
          tableView: { schema: 'public', table: 'users' },
        }),
      ),
    ).toBe('table');
  });
});

describe('iconForEditorTab', () => {
  it('maps sql tabs to File', () => {
    expect(iconForEditorTab(tab())).toBe(File);
  });

  it('maps table view tabs to Table2', () => {
    expect(iconForEditorTab(tab({ tableView: { schema: 'public', table: 'users' } }))).toBe(Table2);
  });

  it('maps saved query tabs to Bookmark', () => {
    expect(iconForEditorTab(tab({ savedQueryId: 'sq-1' }))).toBe(Bookmark);
  });
});

describe('iconForQuickSearchKind', () => {
  it('maps sql to File', () => {
    expect(iconForQuickSearchKind('sql')).toBe(File);
  });

  it('maps table to Table2', () => {
    expect(iconForQuickSearchKind('table')).toBe(Table2);
  });

  it('maps saved to Bookmark', () => {
    expect(iconForQuickSearchKind('saved')).toBe(Bookmark);
  });

  it('maps conn to Database', () => {
    expect(iconForQuickSearchKind('conn')).toBe(Database);
  });
});
