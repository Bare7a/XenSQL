import { describe, expect, it } from 'vitest';
import { findTableViewTab, isTableViewOpenInTabs } from '@/features/table-view/lib/tableViewTab';
import type { EditorTab } from '@/types';

function tableTab(id: string, connectionId: string, schema: string, table: string): EditorTab {
  return {
    id,
    connectionId,
    title: table,
    sql: '',
    color: '#abc',
    tableView: { schema, table },
  };
}

describe('findTableViewTab', () => {
  it('finds an exact match by connection + schema + table', () => {
    const tabs = [tableTab('a', 'c1', 'public', 'users'), tableTab('b', 'c1', 'public', 'orders')];
    expect(findTableViewTab(tabs, 'c1', 'public', 'orders')?.id).toBe('b');
  });

  it('returns undefined for a different connection', () => {
    const tabs = [tableTab('a', 'c1', 'public', 'users')];
    expect(findTableViewTab(tabs, 'c2', 'public', 'users')).toBeUndefined();
  });

  it('returns undefined for a different schema', () => {
    const tabs = [tableTab('a', 'c1', 'public', 'users')];
    expect(findTableViewTab(tabs, 'c1', 'private', 'users')).toBeUndefined();
  });

  it('skips query tabs (no tableView)', () => {
    const tabs: EditorTab[] = [
      {
        id: 'a',
        connectionId: 'c1',
        title: 'Query 1',
        sql: 'SELECT 1',
        color: '#abc',
      },
    ];
    expect(findTableViewTab(tabs, 'c1', 'public', 'users')).toBeUndefined();
  });
});

describe('isTableViewOpenInTabs', () => {
  it('true when the same table is already open', () => {
    expect(isTableViewOpenInTabs([tableTab('a', 'c1', 'public', 'users')], 'c1', 'public', 'users')).toBe(true);
  });

  it('false when no matching tab exists', () => {
    expect(isTableViewOpenInTabs([], 'c1', 'public', 'users')).toBe(false);
  });
});
