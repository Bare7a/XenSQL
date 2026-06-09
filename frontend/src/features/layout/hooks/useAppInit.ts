import { useEffect } from 'react';
import { api } from '@/shared/lib/api';
import { refreshSavedQueries } from '@/shared/lib/savedQueriesSync';
import { useAppStore } from '@/store/appStore';
import type { EditorTab } from '@/types';
import { emptyTableViewPending } from '@/types';

function normalizeRestoredTabs(tabs: EditorTab[]): EditorTab[] {
  return tabs.map((t) => ({
    ...t,
    sql: t.tableView ? '' : t.sql,
    savedSqlBaseline: t.savedQueryId && t.savedSqlBaseline === undefined ? t.sql : t.savedSqlBaseline,
  }));
}

function initTableViewTabSession(tab: EditorTab): void {
  const tv = tab.tableView;
  if (!tv) return;
  const { updateTabSession } = useAppStore.getState();
  updateTabSession(tab.id, {
    tableViewState: {
      schema: tv.schema,
      table: tv.table,
      filter: tv.filter ?? '',
      orderBy: tv.orderBy ?? null,
      orderDir: tv.orderDir ?? 'ASC',
      rows: [],
      columns: [],
      columnTypes: [],
      primaryKeys: [],
      hasMore: false,
      pending: emptyTableViewPending(),
    },
    dataBrowser: { schema: tv.schema, table: tv.table },
    result: null,
    resultError: null,
  });
}

export function useAppInit() {
  const { setConnections, setFolders, setTabs, setActiveTab, setConnected } = useAppStore();

  useEffect(() => {
    async function init() {
      const [connections, folders, session] = await Promise.all([
        api.listConnections(),
        api.listFolders(),
        api.getEditorSession(),
        refreshSavedQueries(),
      ]);
      setConnections(connections);
      setFolders(folders);
      if (session?.tabs?.length) {
        const restored = normalizeRestoredTabs(session.tabs);
        setTabs(restored);
        setActiveTab(session.activeTab || restored[0].id);
        for (const tab of restored) {
          initTableViewTabSession(tab);
        }
      }
      for (const c of connections) {
        try {
          const connected = await api.isConnected(c.id);
          setConnected(c.id, connected);
        } catch {
          /* ignore */
        }
      }
    }
    init();
  }, [setConnections, setFolders, setTabs, setActiveTab, setConnected]);

  useEffect(() => {
    const save = () => {
      const { tabs, activeTabId, tabSession } = useAppStore.getState();
      // Fold each table-view tab's live (applied) filter + sort back into its persisted tableView ref
      // so a restart restores them alongside schema/table.
      const tabsToSave = tabs.map((tab) => {
        if (!tab.tableView) return tab;
        const live = tabSession[tab.id]?.tableViewState;
        if (!live) return tab;
        return {
          ...tab,
          tableView: {
            ...tab.tableView,
            filter: live.filter,
            orderBy: live.orderBy,
            orderDir: live.orderDir,
          },
        };
      });
      api.saveEditorSession({ tabs: tabsToSave, activeTab: activeTabId || '' }).catch(() => {});
    };
    const id = setInterval(save, 5000);
    window.addEventListener('beforeunload', save);
    return () => {
      clearInterval(id);
      window.removeEventListener('beforeunload', save);
    };
  }, []);
}
