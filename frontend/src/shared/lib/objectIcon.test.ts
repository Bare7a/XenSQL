import { Bookmark, Database, File, FunctionSquare, Hash, KeyRound, Table2, View, Zap } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { iconFor, iconForEditorTab, isViewKind, relationKindOf } from '@/shared/lib/objectIcon';
import type { EditorTab, TableInfo } from '@/types';

const tab = (over: Partial<EditorTab> = {}): EditorTab => ({
  id: 'tab-1',
  connectionId: 'conn-1',
  title: 'Query 1',
  sql: 'SELECT 1',
  color: '#abc',
  ...over,
});

const table = (name: string, type: string): TableInfo => ({ schema: 'public', name, type });

describe('iconFor', () => {
  it('maps every object kind', () => {
    expect(iconFor('table')).toBe(Table2);
    expect(iconFor('view')).toBe(View);
    expect(iconFor('materialized view')).toBe(View);
    expect(iconFor('index')).toBe(Hash);
    expect(iconFor('constraint')).toBe(KeyRound);
    expect(iconFor('trigger')).toBe(Zap);
    expect(iconFor('function')).toBe(FunctionSquare);
    expect(iconFor('procedure')).toBe(FunctionSquare);
  });

  it('maps the app’s own concepts', () => {
    expect(iconFor('connection')).toBe(Database);
    expect(iconFor('query')).toBe(File);
    expect(iconFor('savedQuery')).toBe(Bookmark);
  });

  it('falls back to a table for anything unrecognised', () => {
    expect(iconFor(undefined)).toBe(Table2);
    expect(iconFor(null)).toBe(Table2);
    expect(iconFor('nonsense')).toBe(Table2);
  });
});

describe('relationKindOf', () => {
  const tables = {
    'conn-1:public': [table('users', 'table'), table('active_users', 'view')],
  };

  it('reads the kind of the relation a tab is browsing', () => {
    expect(relationKindOf(tables, tab({ tableView: { schema: 'public', table: 'active_users' } }))).toBe('view');
    expect(relationKindOf(tables, tab({ tableView: { schema: 'public', table: 'users' } }))).toBe('table');
  });

  it('is undefined for a tab that browses nothing', () => {
    expect(relationKindOf(tables, tab())).toBeUndefined();
  });

  it('is undefined when that schema is not loaded yet', () => {
    expect(relationKindOf({}, tab({ tableView: { schema: 'public', table: 'users' } }))).toBeUndefined();
    expect(
      relationKindOf(tables, tab({ connectionId: 'conn-2', tableView: { schema: 'public', table: 'users' } })),
    ).toBeUndefined();
  });
});

describe('iconForEditorTab', () => {
  it('gives a view-browsing tab the view icon', () => {
    expect(iconForEditorTab(tab({ tableView: { schema: 'public', table: 'v' } }), 'view')).toBe(View);
  });

  it('gives a table-browsing tab the table icon', () => {
    expect(iconForEditorTab(tab({ tableView: { schema: 'public', table: 't' } }), 'table')).toBe(Table2);
  });

  it('falls back to a table when the schema has not loaded', () => {
    expect(iconForEditorTab(tab({ tableView: { schema: 'public', table: 't' } }))).toBe(Table2);
  });

  it('maps saved query and plain sql tabs', () => {
    expect(iconForEditorTab(tab({ savedQueryId: 'sq-1' }))).toBe(Bookmark);
    expect(iconForEditorTab(tab())).toBe(File);
  });

  it('prefers the browsed relation over a saved query id', () => {
    expect(iconForEditorTab(tab({ savedQueryId: 'sq-1', tableView: { schema: 'public', table: 'v' } }), 'view')).toBe(
      View,
    );
  });
});

describe('isViewKind', () => {
  it('treats plain and materialized views alike', () => {
    expect(isViewKind('view')).toBe(true);
    expect(isViewKind('materialized view')).toBe(true);
    expect(isViewKind('table')).toBe(false);
    expect(isViewKind(undefined)).toBe(false);
  });
});
