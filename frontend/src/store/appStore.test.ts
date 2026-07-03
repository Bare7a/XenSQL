import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type EditorTab, tableViewStateFrom } from '@/types';

vi.mock('@/shared/lib/api', () => ({ api: {} }));

const { useAppStore } = await import('@/store/appStore');

const tableViewTab = (): EditorTab => ({
  id: 'tab-tv',
  connectionId: 'conn-1',
  title: 'employees',
  sql: '',
  color: '#4f8cc9',
  tableView: { schema: 'main', table: 'employees' },
});

function openTabWithLiveState(): void {
  const tab = tableViewTab();
  const store = useAppStore.getState();
  store.addTab(tab);
  store.updateTabSession(tab.id, {
    tableViewState: {
      // biome-ignore lint/style/noNonNullAssertion: fixture always sets tableView
      ...tableViewStateFrom(tab.tableView!),
      filter: 'id > 1',
      orderBy: 'name',
      orderDir: 'DESC',
      hiddenColumns: ['name'],
    },
  });
}

describe('appStore table-view tab lifecycle', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null, tabSession: {}, closedTabs: [], runningTabId: null });
  });

  it('closeTab folds live filter/sort/hidden columns into the closed tab and drops the session', () => {
    openTabWithLiveState();

    useAppStore.getState().closeTab('tab-tv');

    const state = useAppStore.getState();
    expect(state.tabs).toHaveLength(0);
    expect(state.tabSession['tab-tv']).toBeUndefined();
    expect(state.closedTabs[state.closedTabs.length - 1]?.tableView).toMatchObject({
      schema: 'main',
      table: 'employees',
      filter: 'id > 1',
      orderBy: 'name',
      orderDir: 'DESC',
      hiddenColumns: ['name'],
    });
  });

  it('reopenClosedTab restores the tab and seeds its session from the folded state', () => {
    openTabWithLiveState();
    useAppStore.getState().closeTab('tab-tv');

    useAppStore.getState().reopenClosedTab();

    const state = useAppStore.getState();
    expect(state.activeTabId).toBe('tab-tv');
    expect(state.closedTabs).toHaveLength(0);
    expect(state.tabSession['tab-tv']?.tableViewState).toMatchObject({
      filter: 'id > 1',
      orderBy: 'name',
      orderDir: 'DESC',
      hiddenColumns: ['name'],
      rows: [],
      columns: [],
    });
  });
});
