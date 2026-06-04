import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api, newTabId } from '@/shared/lib/api';
import { appAlert, appError } from '@/shared/lib/appDialog';
import {
  useActiveTab,
  useConnectedIds,
  useConnections,
  useSelectedConnectionId,
  useStoreActions,
  useTabs,
} from '@/store/selectors';
import { emptyTableViewPending, type EditorTab } from '@/types';

export function useTabOpener(setConnPickerOpen: (open: boolean) => void) {
  const { t } = useTranslation();
  const connections = useConnections();
  const tabs = useTabs();
  const activeTab = useActiveTab();
  const connectedIds = useConnectedIds();
  const selectedConnectionId = useSelectedConnectionId();
  const {
    addTab,
    updateTab,
    setActiveTab,
    updateTabSession,
    setSelectedConnection,
    setConnected,
  } = useStoreActions();

  const openQueryTab = useCallback(
    (connectionId: string, sql?: string, options?: { forceNew?: boolean; title?: string }) => {
      const conn = connections.find((c) => c.id === connectionId);
      if (!conn) return;
      setSelectedConnection(connectionId);
      const queryPrefix = t('app.queryTabPrefix');
      const existing =
        !options?.forceNew &&
        tabs.find(
          (tab) =>
            tab.connectionId === connectionId &&
            !tab.savedQueryId &&
            tab.title.startsWith(queryPrefix)
        );
      if (existing && sql) {
        updateTab(existing.id, { sql });
        setActiveTab(existing.id);
        return;
      }
      const tabNum =
        tabs.filter((tab) => tab.connectionId === connectionId && !tab.savedQueryId).length + 1;
      const tab: EditorTab = {
        id: newTabId(),
        connectionId,
        title:
          options?.title ||
          (sql
            ? t('app.queryTab', { num: tabNum })
            : t('app.queryTabWithConn', { num: tabNum, conn: conn.name })),
        sql: sql || '',
        color: conn.color,
      };
      addTab(tab);
    },
    [connections, tabs, addTab, updateTab, setActiveTab, setSelectedConnection, t]
  );

  // Selecting/connecting a connection should land you in a usable tab: focus an
  // existing query tab for it, or open one if it has none. No-op when you're
  // already on that connection, so re-selecting it never stacks a tab.
  const focusOrOpenConnectionTab = useCallback(
    (connectionId: string) => {
      setSelectedConnection(connectionId);
      if (activeTab?.connectionId === connectionId) return;
      const existing = tabs.find(
        (tab) => tab.connectionId === connectionId && !tab.savedQueryId && !tab.tableView
      );
      if (existing) {
        setActiveTab(existing.id);
        return;
      }
      openQueryTab(connectionId);
    },
    [activeTab?.connectionId, tabs, openQueryTab, setActiveTab, setSelectedConnection]
  );

  const openTableViewTab = useCallback(
    (connId: string, schema: string, table: string) => {
      const conn = connections.find((c) => c.id === connId);
      if (!conn) return;

      const existing = tabs.find(
        (tab) =>
          tab.tableView?.schema === schema &&
          tab.tableView?.table === table &&
          tab.connectionId === connId
      );
      if (existing) {
        setSelectedConnection(connId);
        setActiveTab(existing.id);
        return;
      }

      setSelectedConnection(connId);
      const tab: EditorTab = {
        id: newTabId(),
        connectionId: connId,
        title: table,
        sql: '',
        color: conn.color,
        tableView: { schema, table },
      };
      addTab(tab);
      updateTabSession(tab.id, {
        tableViewState: {
          schema,
          table,
          filter: '',
          orderBy: null,
          orderDir: 'ASC',
          rows: [],
          columns: [],
          columnTypes: [],
          primaryKeys: [],
          hasMore: false,
          pending: emptyTableViewPending(),
        },
        dataBrowser: { schema, table },
        result: null,
        resultError: null,
      });
    },
    [connections, tabs, addTab, setActiveTab, setSelectedConnection, updateTabSession]
  );

  const openNewTabForConnection = useCallback(
    (connId: string) => {
      setConnPickerOpen(false);
      if (!connectedIds[connId]) {
        api
          .connect(connId)
          .then(() => {
            setConnected(connId, true);
            openQueryTab(connId);
          })
          .catch((e) => void appError(e, t('errors.couldNotConnect')));
        return;
      }
      openQueryTab(connId);
    },
    [connectedIds, setConnected, openQueryTab, setConnPickerOpen, t]
  );

  const requireDatabaseAlert = useCallback(
    () =>
      appAlert({
        title: t('dialog.noDatabaseTitle'),
        description: t('dialog.noDatabaseDescription'),
      }),
    [t]
  );

  const handleNewTabButton = useCallback(() => {
    if (connections.length === 0) return void requireDatabaseAlert();
    if (connections.length === 1) return openNewTabForConnection(connections[0].id);
    setConnPickerOpen(true);
  }, [connections, openNewTabForConnection, requireDatabaseAlert, setConnPickerOpen]);

  const handleNewTabShortcut = useCallback(() => {
    if (connections.length === 0) return void requireDatabaseAlert();
    if (connections.length === 1) return openNewTabForConnection(connections[0].id);
    const unambiguous = activeTab?.connectionId || selectedConnectionId;
    if (unambiguous) return openNewTabForConnection(unambiguous);
    setConnPickerOpen(true);
  }, [connections, activeTab?.connectionId, selectedConnectionId, openNewTabForConnection, requireDatabaseAlert, setConnPickerOpen]);

  return {
    openQueryTab,
    focusOrOpenConnectionTab,
    openTableViewTab,
    openNewTabForConnection,
    handleNewTabButton,
    handleNewTabShortcut,
  };
}
