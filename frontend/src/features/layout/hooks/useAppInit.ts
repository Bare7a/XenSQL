import { useEffect } from 'react';
import { api } from '@/shared/lib/api';
import { refreshSavedQueries } from '@/shared/lib/savedQueriesSync';
import { useAppStore } from '@/store/appStore';
import type { EditorTab } from '@/types';
import { tableViewStateFrom } from '@/types';

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
    tableViewState: tableViewStateFrom(tv),
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
    // Skip identical payloads: the interval fires unconditionally and streaming churns tabSession.
    let lastSaved = '';
    const save = () => {
      const { tabs, activeTabId, tabSession } = useAppStore.getState();
      // Fold each table-view tab's live filter/sort/hidden columns into its persisted ref so a restart restores them.
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
            hiddenColumns: live.hiddenColumns,
          },
        };
      });
      const session = { tabs: tabsToSave, activeTab: activeTabId || '' };
      const serialized = JSON.stringify(session);
      if (serialized === lastSaved) return;
      lastSaved = serialized;
      api.saveEditorSession(session).catch(() => {});
    };
    // Desktop quit doesn't reliably fire beforeunload, so also save on store changes: debounced,
    // except tab open/close saves immediately so a quick quit can't restore a stale tab list.
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (s.tabs === prev.tabs && s.activeTabId === prev.activeTabId && s.tabSession === prev.tabSession) return;
      clearTimeout(debounce);
      if (s.tabs.length !== prev.tabs.length) {
        save();
        return;
      }
      debounce = setTimeout(save, 1000);
    });
    const id = setInterval(save, 5000);
    window.addEventListener('beforeunload', save);
    return () => {
      unsubscribe();
      clearTimeout(debounce);
      clearInterval(id);
      window.removeEventListener('beforeunload', save);
    };
  }, []);
}
