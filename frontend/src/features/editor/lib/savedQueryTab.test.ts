import { describe, expect, it } from 'vitest';
import {
  findTabForSavedQuery,
  isSavedQueryOpenInTabs,
  isSavedQueryTabDirty,
} from '@/features/editor/lib/savedQueryTab';
import type { EditorTab, SavedQuery } from '@/types';

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

function saved(overrides: Partial<SavedQuery> = {}): SavedQuery {
  return {
    id: 'sq-1',
    name: 'Saved A',
    sql: 'SELECT 1',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('isSavedQueryTabDirty', () => {
  it('false when tab is not linked to a saved query', () => {
    expect(isSavedQueryTabDirty(tab({ sql: 'changed' }))).toBe(false);
  });

  it('false when sql matches the baseline', () => {
    expect(
      isSavedQueryTabDirty(
        tab({ savedQueryId: 'sq-1', sql: 'SELECT 1', savedSqlBaseline: 'SELECT 1' })
      )
    ).toBe(false);
  });

  it('true when sql diverges from the baseline', () => {
    expect(
      isSavedQueryTabDirty(
        tab({ savedQueryId: 'sq-1', sql: 'SELECT 2', savedSqlBaseline: 'SELECT 1' })
      )
    ).toBe(true);
  });

  it('treats missing baseline as empty', () => {
    expect(isSavedQueryTabDirty(tab({ savedQueryId: 'sq-1', sql: 'x' }))).toBe(true);
  });
});

describe('findTabForSavedQuery', () => {
  it('matches by saved-query id first', () => {
    const tabs: EditorTab[] = [tab({ id: 'a', savedQueryId: 'sq-1' })];
    expect(findTabForSavedQuery(tabs, saved())?.id).toBe('a');
  });

  it('falls back to an unbound tab with the same title on the same connection', () => {
    const tabs: EditorTab[] = [
      tab({ id: 'a', title: 'Other' }),
      tab({ id: 'b', title: 'Saved A', connectionId: 'conn-1' }),
    ];
    expect(findTabForSavedQuery(tabs, saved({ connectionId: 'conn-1' }))?.id).toBe('b');
  });

  it('does not match a linked-elsewhere tab when title coincidentally matches', () => {
    const tabs: EditorTab[] = [
      tab({ id: 'a', savedQueryId: 'other-sq', title: 'Saved A' }),
    ];
    expect(findTabForSavedQuery(tabs, saved())).toBeUndefined();
  });

  it('matches by title on any connection when saved.connectionId is missing', () => {
    const tabs: EditorTab[] = [tab({ id: 'a', title: 'Saved A', connectionId: 'c2' })];
    expect(findTabForSavedQuery(tabs, saved())?.id).toBe('a');
  });
});

describe('isSavedQueryOpenInTabs', () => {
  it('mirrors findTabForSavedQuery', () => {
    const tabs: EditorTab[] = [tab({ savedQueryId: 'sq-1' })];
    expect(isSavedQueryOpenInTabs(tabs, saved())).toBe(true);
    expect(isSavedQueryOpenInTabs([], saved())).toBe(false);
  });
});
