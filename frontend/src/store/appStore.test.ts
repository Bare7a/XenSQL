import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type EditorTab, type QueryPlan, tableViewStateFrom } from '@/types';

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

const queryTab = (): EditorTab => ({
  id: 'tab-q',
  connectionId: 'conn-1',
  title: 'Query 1',
  sql: 'SELECT 1',
  color: '#4f8cc9',
});

const samplePlan = (label: string): QueryPlan => ({
  driver: 'postgres',
  statement: 'SELECT 1',
  explainSql: 'EXPLAIN (FORMAT JSON) SELECT 1',
  analyzed: false,
  nodes: [{ label }],
  durationMs: 1,
  raw: '[]',
});

describe('appStore query plans as result sets', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null, tabSession: {}, closedTabs: [], runningTabId: null });
    useAppStore.getState().addTab(queryTab());
  });

  it('finalizes a plan statement as its own result set, carrying no grid', () => {
    const store = useAppStore.getState();
    store.startResultSet('tab-q', {
      streamId: '1',
      resultIndex: 0,
      columns: ['id'],
      columnTypes: ['INTEGER'],
    });
    store.appendResultRows('tab-q', '1', 0, [[1]]);
    store.finalizeResultSet('tab-q', '1', 0, null, null, 'SELECT 1', null);
    store.finalizeResultSet('tab-q', '1', 1, null, samplePlan('Seq Scan'), 'EXPLAIN SELECT 1', null);

    const session = useAppStore.getState().getTabSession('tab-q');
    expect(session.results).toHaveLength(2);
    expect(session.results[0].plan).toBeUndefined();
    expect(session.results[0].result?.rows).toEqual([[1]]);
    expect(session.results[1].plan?.nodes[0].label).toBe('Seq Scan');
    expect(session.results[1].result).toBeNull();
  });

  it('reports a failed explain as an error set, not a plan', () => {
    const store = useAppStore.getState();
    store.finalizeResultSet('tab-q', '1', 0, null, null, 'EXPLAIN SELECT 1', 'relation does not exist');

    const session = useAppStore.getState().getTabSession('tab-q');
    expect(session.results[0].plan).toBeUndefined();
    expect(session.results[0].error).toBe('relation does not exist');
    expect(session.resultError).toBe('relation does not exist');
  });

  it('showPlan replaces the tab output with the one plan', () => {
    const store = useAppStore.getState();
    store.updateTabSession('tab-q', { dataBrowser: { schema: 'main', table: 't' } });
    store.showPlan('tab-q', samplePlan('Nested Loop'));

    const session = useAppStore.getState().getTabSession('tab-q');
    expect(session.results).toHaveLength(1);
    expect(session.results[0].plan?.nodes[0].label).toBe('Nested Loop');
    expect(session.activeResultIndex).toBe(0);
    // A plan is not table data, so the browse toolbar must go.
    expect(session.dataBrowser).toBeNull();
    expect(session.result).toBeNull();
    expect(session.resultError).toBeNull();
  });

  it('a new run clears a plan from the previous one', () => {
    const store = useAppStore.getState();
    store.showPlan('tab-q', samplePlan('Seq Scan'));
    store.updateTabSession('tab-q', { result: null, resultError: null, dataBrowser: null });

    expect(useAppStore.getState().getTabSession('tab-q').results).toEqual([]);
  });

  it('ignores a plan from a superseded run', () => {
    const store = useAppStore.getState();
    store.startResultSet('tab-q', { streamId: '2', resultIndex: 0, columns: ['id'], columnTypes: ['INTEGER'] });
    store.finalizeResultSet('tab-q', '1', 0, null, samplePlan('Stale'), 'EXPLAIN SELECT 1', null);

    const session = useAppStore.getState().getTabSession('tab-q');
    expect(session.results[0]?.plan).toBeUndefined();
  });
});
