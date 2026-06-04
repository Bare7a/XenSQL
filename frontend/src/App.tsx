import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database } from 'lucide-react';
import { AppTitleBar, type AppMenuAction } from '@/features/layout/AppTitleBar';
import { AboutDialog } from '@/shared/components/AboutDialog';
import { ShortcutsDialog } from '@/shared/components/ShortcutsDialog';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { RowJsonViewer } from '@/features/results/RowJsonViewer';
import { AppDialogHost } from '@/shared/components/AppDialogHost';
import { AppTooltipLayer } from '@/shared/components/AppTooltipLayer';
import { AppToastLayer } from '@/shared/components/AppToastLayer';
import { AppStatusBar } from '@/features/layout/AppStatusBar';
import { EditorPane } from '@/features/editor/EditorPane';
import { EditorTabBar } from '@/features/editor/EditorTabBar';
import { ResultsPane } from '@/features/results/ResultsPane';
import { KeyboardTipsDialog } from '@/shared/components/KeyboardTipsDialog';
import { RenameQueryDialog } from '@/features/editor/RenameQueryDialog';
import { UnsavedQueryDialog } from '@/features/editor/UnsavedQueryDialog';
import { ConnectionPickerMenu } from '@/features/connections/ConnectionPickerMenu';
import { QuickSearchDialog } from '@/features/layout/QuickSearchDialog';
import { TableViewPane } from '@/features/table-view/TableViewPane';
import { useAppInit } from '@/features/layout/hooks/useAppInit';
import { useHorizontalWheelScroll } from '@/shared/hooks/useHorizontalWheelScroll';
import { useAppInfo } from '@/features/layout/hooks/useAppInfo';
import { useFileDropZone } from '@/features/connections/hooks/useFileDropZone';
import { useOpenSqliteEvents } from '@/features/connections/hooks/useOpenSqliteEvents';
import { useQueryStreamEvents } from '@/features/editor/hooks/useQueryStreamEvents';
import { useQueryRunner } from '@/features/editor/hooks/useQueryRunner';
import { useTransactionActions } from '@/features/editor/hooks/useTransactionActions';
import { useSavedQueryActions } from '@/features/editor/hooks/useSavedQueryActions';
import { useTabOpener } from '@/features/editor/hooks/useTabOpener';
import { useGlobalShortcuts } from '@/features/layout/hooks/useGlobalShortcuts';
import { useFullscreenToggle } from '@/features/layout/hooks/useFullscreenToggle';
import { usePersistedToggle } from '@/shared/hooks/usePersistedToggle';
import { usePersistedPanelWidth } from '@/features/layout/hooks/usePersistedPanelWidth';
import { useVerticalSplitter } from '@/features/layout/hooks/useVerticalSplitter';
import { useConnectionStatus } from '@/features/connections/hooks/useConnectionStatus';
import { useSchemaPreloader } from '@/features/editor/hooks/useSchemaPreloader';
import { useScrollActiveTabIntoView } from '@/features/editor/hooks/useScrollActiveTabIntoView';
import { api } from '@/shared/lib/api';
import { isSavedQueryTabDirty } from '@/features/editor/lib/savedQueryTab';
import { resetUiZoom, zoomUiIn, zoomUiOut } from '@/shared/lib/uiZoom';
import { STORAGE_KEYS } from '@/shared/lib/storageKeys';
import {
  useActiveTab,
  useActiveTabId,
  useActiveTabSession,
  useConnectedIds,
  useConnections,
  useRunningTabId,
  useSavedQueries,
  useSchemas,
  useStoreActions,
  useTabSessionMap,
  useTablesMap,
  useTabs,
} from '@/store/selectors';
import type { EditorCursorState, EditorTab, TableInfo, TxnState } from '@/types';
import '@/styles/global.css';
import '@/styles/utilities.css';

// Stable empty array so connections with no cached tables don't churn referential equality.
const EMPTY_TABLES: TableInfo[] = [];

function App() {
  useAppInit();
  const { t } = useTranslation();

  const connections = useConnections();
  const tabs = useTabs();
  const activeTabId = useActiveTabId();
  const activeTab = useActiveTab();
  const activeSession = useActiveTabSession();
  // Inactive ResultsGrids stay mounted and re-render on their own result
  const tabSession = useTabSessionMap();
  const runningTabId = useRunningTabId();
  const connectedIds = useConnectedIds();
  const schemas = useSchemas();
  const tables = useTablesMap();
  const savedQueries = useSavedQueries();
  const {
    updateTab,
    closeTab,
    setActiveTab,
    updateTabSession,
    setSelectedConnection,
    reorderTabs,
  } = useStoreActions();

  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dropTabId, setDropTabId] = useState<string | null>(null);
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [renameTabId, setRenameTabId] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [connPickerOpen, setConnPickerOpen] = useState(false);

  const { runQueryForTab, cancelQueryForTab } = useQueryRunner();
  const { beginTransaction, commitTransaction, rollbackTransaction, cleanupTabTransaction } =
    useTransactionActions();
  const {
    persistTabSavedQuery,
    handleSaveQuery,
    openRenameDialog,
    confirmRenameSavedQuery,
    openSavedQuery,
  } = useSavedQueryActions(renameTabId, setRenameTabId);
  const {
    openQueryTab,
    focusOrOpenConnectionTab,
    openTableViewTab,
    openNewTabForConnection,
    handleNewTabButton,
    handleNewTabShortcut,
  } = useTabOpener(setConnPickerOpen);

  const sidebar = usePersistedPanelWidth({
    storageKey: STORAGE_KEYS.sidebarWidth,
    defaultWidth: 280,
    min: 200,
    max: 520,
    edge: 'right',
  });
  const jsonPanel = usePersistedPanelWidth({
    storageKey: STORAGE_KEYS.jsonPanelWidth,
    defaultWidth: 320,
    min: 220,
    max: 640,
    edge: 'left',
  });
  const sidebarVisible = usePersistedToggle(STORAGE_KEYS.sidebarOpen, true);
  const jsonPanelVisible = usePersistedToggle(STORAGE_KEYS.jsonPanelOpen, false);
  const resultsSplit = useVerticalSplitter({
    initialPercent: 40,
    minPercent: 15,
    maxPercent: 70,
    containerSelector: '.main-area',
  });

  const editorTabsRef = useRef<HTMLDivElement>(null);
  const addTabBtnRef = useRef<HTMLButtonElement>(null);
  useHorizontalWheelScroll(editorTabsRef);

  const appInfo = useAppInfo();
  const { fileDragOver } = useFileDropZone();
  useOpenSqliteEvents();

  const connectionsById = useMemo(() => {
    const m = new Map<string, (typeof connections)[number]>();
    for (const c of connections) m.set(c.id, c);
    return m;
  }, [connections]);
  const queryTabs = useMemo(() => tabs.filter((tab) => !tab.tableView), [tabs]);
  const tabTxnStates = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(tabSession)
          .filter(([, s]) => s.txnState)
          .map(([id, s]) => [id, s.txnState as TxnState])
      ),
    [tabSession]
  );
  const activeConn = activeTab ? connectionsById.get(activeTab.connectionId) : undefined;
  const activeResult = activeSession.result;
  const activeResultError = activeSession.resultError;
  const activeFocusedRow = activeSession.focusedRow;
  // null !== null guard: with no tabs both ids are null, which would read as "running"
  const isRunning = runningTabId !== null && runningTabId === activeTabId;

  useEffect(() => {
    if (activeTab) setSelectedConnection(activeTab.connectionId);
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { status: connStatus, setStatus: setConnStatus } = useConnectionStatus(
    activeTab?.connectionId,
    activeTab ? !!connectedIds[activeTab.connectionId] : false
  );
  useQueryStreamEvents(setConnStatus);

  const { loadColumnsForConnection } = useSchemaPreloader(tabs, connections.length);
  // Group the table cache by connection once → each editor gets a stable array ref (rebuilt only
  // when `tables` changes, not per keystroke render).
  const tablesByConnection = useMemo(() => {
    const grouped: Record<string, TableInfo[]> = {};
    for (const key in tables) {
      const sep = key.indexOf(':');
      if (sep < 0) continue;
      (grouped[key.slice(0, sep)] ||= []).push(...tables[key]);
    }
    return grouped;
  }, [tables]);
  const tablesForConnection = useCallback(
    (connectionId: string) => tablesByConnection[connectionId] ?? EMPTY_TABLES,
    [tablesByConnection]
  );

  const selectTab = useCallback(
    (tab: EditorTab) => {
      setSelectedConnection(tab.connectionId);
      setActiveTab(tab.id);
    },
    [setSelectedConnection, setActiveTab]
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((tab) => tab.id === tabId);
      if (tab && isSavedQueryTabDirty(tab)) {
        setPendingCloseTabId(tabId);
        return;
      }
      // Implicit cancel: backend otherwise keeps streaming rows for a closed tab
      if (tab && runningTabId === tabId) {
        void api.cancelQuery(tab.connectionId);
      }
      const txnState = tabSession[tabId]?.txnState;
      if (txnState === 'active' || txnState === 'error') {
        void cleanupTabTransaction(tabId);
      }
      closeTab(tabId);
    },
    [tabs, tabSession, closeTab, runningTabId, cleanupTabTransaction]
  );

  const pendingCloseTab = tabs.find((tab) => tab.id === pendingCloseTabId);
  const renameTargetTab = tabs.find((tab) => tab.id === renameTabId);

  const focusedRowKeyCacheRef = useRef<Map<string, string>>(new Map());
  const handleFocusedRowChangeForTab = useCallback(
    (tabId: string, row: Record<string, unknown> | null) => {
      const cache = focusedRowKeyCacheRef.current;
      const rowKey = row ? JSON.stringify(row) : '';
      if (cache.get(tabId) === rowKey) return;
      cache.set(tabId, rowKey);
      updateTabSession(tabId, { focusedRow: row });
    },
    [updateTabSession]
  );

  const handleEditorCursorChange = useCallback(
    (tabId: string, editorCursor: EditorCursorState) => {
      const tab = tabs.find((tab) => tab.id === tabId);
      const prev = tab?.editorCursor;
      if (
        prev &&
        prev.lineNumber === editorCursor.lineNumber &&
        prev.column === editorCursor.column &&
        prev.scrollTop === editorCursor.scrollTop
      ) {
        return;
      }
      updateTab(tabId, { editorCursor });
    },
    [tabs, updateTab]
  );

  const switchEditorTab = useCallback(
    (direction: 'prev' | 'next') => {
      if (tabs.length < 2 || !activeTabId) return;
      const idx = tabs.findIndex((tab) => tab.id === activeTabId);
      if (idx < 0) return;
      const nextIdx =
        direction === 'next'
          ? (idx + 1) % tabs.length
          : (idx - 1 + tabs.length) % tabs.length;
      setActiveTab(tabs[nextIdx].id);
    },
    [tabs, activeTabId, setActiveTab]
  );

  useScrollActiveTabIntoView(editorTabsRef, tabs, activeTabId);

  const toggleFullscreen = useFullscreenToggle();

  useGlobalShortcuts({
    prevTab: () => switchEditorTab('prev'),
    nextTab: () => switchEditorTab('next'),
    closeTab: () => {
      if (activeTabId) handleCloseTab(activeTabId);
    },
    newTab: handleNewTabShortcut,
    quickSearch: () => setQuickSearchOpen(true),
    toggleSidebar: sidebarVisible.toggle,
    toggleJsonPanel: jsonPanelVisible.toggle,
    zoomIn: zoomUiIn,
    zoomOut: zoomUiOut,
    resetZoom: resetUiZoom,
    toggleFullscreen: () => void toggleFullscreen(),
  });

  const handleMenuAction = useCallback(
    (action: AppMenuAction) => {
      if (action === 'about') setAboutOpen(true);
      if (action === 'shortcuts') setShortcutsOpen(true);
      if (action === 'tips') setTipsOpen(true);
      if (action === 'newTab') handleNewTabShortcut();
      if (action === 'closeTab' && activeTabId) handleCloseTab(activeTabId);
      if (action === 'quickSearch') setQuickSearchOpen(true);
    },
    [handleNewTabShortcut, handleCloseTab, activeTabId]
  );

  const handleChangeSql = useCallback(
    (tabId: string, sql: string) => updateTab(tabId, { sql }),
    [updateTab]
  );
  const handleRunForTab = useCallback(
    (tabId: string, sql: string) => void runQueryForTab(tabId, sql),
    [runQueryForTab]
  );
  const handleSaveQueryWrapped = useCallback(
    () => void handleSaveQuery(),
    [handleSaveQuery]
  );
  const handleDragEnd = useCallback(() => {
    setDragTabId(null);
    setDropTabId(null);
  }, []);
  const handleDragLeaveTab = useCallback(
    (id: string) => {
      if (dropTabId === id) setDropTabId(null);
    },
    [dropTabId]
  );

  return (
    <div className="app-layout">
      <AppTitleBar
        onAction={handleMenuAction}
        sidebarOpen={sidebarVisible.value}
        onToggleSidebar={sidebarVisible.toggle}
        jsonPanelOpen={jsonPanelVisible.value}
        onToggleJsonPanel={jsonPanelVisible.toggle}
      />

      {fileDragOver && (
        <div className="file-drop-overlay">
          <div className="file-drop-overlay-content">
            <Database className="icon-3xl" />
            <span>{t('connection.dropSqlite')}</span>
          </div>
        </div>
      )}

      <div className="app-body">
        {sidebarVisible.value && (
          <>
            <div className="sidebar-shell" style={{ width: sidebar.width }}>
              <Sidebar
                onOpenQuery={openQueryTab}
                onOpenSavedQuery={openSavedQuery}
                onBrowseTable={openTableViewTab}
                onOpenConnectionTab={focusOrOpenConnectionTab}
              />
            </div>
            <div
              className="panel-resize-handle panel-resize-handle-vertical"
              onMouseDown={sidebar.handleResize}
              data-tooltip={t('tooltip.resizeSidebar')}
            />
          </>
        )}

        <main className="main-area">
          <EditorTabBar
            ref={editorTabsRef}
            tabs={tabs}
            activeTabId={activeTabId}
            connections={connections}
            dragTabId={dragTabId}
            dropTabId={dropTabId}
            addTabBtnRef={addTabBtnRef}
            onActivate={setActiveTab}
            onClose={handleCloseTab}
            onAddTab={handleNewTabButton}
            onReorder={reorderTabs}
            onDragStart={setDragTabId}
            onDragEnd={handleDragEnd}
            onDragOverTab={setDropTabId}
            onDragLeaveTab={handleDragLeaveTab}
          />

          {tabs.length === 0 ? (
            <div className="empty-state app-empty-flex">
              <h2>{t('app.emptyTitle')}</h2>
              <p>{t('app.emptyDescription')}</p>
            </div>
          ) : (
            <div className="editor-workspace">
              {tabs.map((tab) =>
                tab.tableView ? (
                  <div
                    key={tab.id}
                    className={`tab-workspace-layer table-view-layer${
                      tab.id === activeTabId ? ' tab-layer-active' : ''
                    }`}
                  >
                    <TableViewPane
                      tab={tab}
                      driver={connectionsById.get(tab.connectionId)?.driver ?? 'postgres'}
                      readOnly={!!connectionsById.get(tab.connectionId)?.readOnly}
                      isActive={tab.id === activeTabId}
                      running={runningTabId === tab.id}
                      onFocusedRowChange={(row) => handleFocusedRowChangeForTab(tab.id, row)}
                    />
                  </div>
                ) : null
              )}
              {activeTab && !activeTab.tableView && (
                <>
                  <EditorPane
                    tabs={queryTabs}
                    activeTabId={activeTabId}
                    connections={connections}
                    runningTabId={runningTabId}
                    schemas={schemas}
                    tablesForConnection={tablesForConnection}
                    loadColumnsForConnection={loadColumnsForConnection}
                    onChangeSql={handleChangeSql}
                    onRun={handleRunForTab}
                    onCancel={cancelQueryForTab}
                    onSaveQuery={handleSaveQueryWrapped}
                    onRenameSavedQuery={openRenameDialog}
                    onCursorStateChange={handleEditorCursorChange}
                    tabTxnStates={tabTxnStates}
                    onBeginTxn={beginTransaction}
                    onCommitTxn={commitTransaction}
                    onRollbackTxn={rollbackTransaction}
                  />
                  <div className="resizer" onMouseDown={resultsSplit.onMouseDown} />
                  <div
                    className="results-pane"
                    style={{ flex: `0 0 ${resultsSplit.percent}%`, minHeight: 0 }}
                  >
                    <ResultsPane
                      tabs={queryTabs}
                      activeTabId={activeTabId}
                      connections={connections}
                      tabSession={tabSession}
                      onFocusedRowChange={handleFocusedRowChangeForTab}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </main>

        {jsonPanelVisible.value && (
          <>
            <div
              className="panel-resize-handle panel-resize-handle-vertical"
              onMouseDown={jsonPanel.handleResize}
              data-tooltip={t('tooltip.resizeJsonPanel')}
            />
            <div className="json-viewer-shell" style={{ width: jsonPanel.width }}>
              <RowJsonViewer
                data={activeFocusedRow}
                onClose={() => jsonPanelVisible.set(false)}
              />
            </div>
          </>
        )}
      </div>

      <AppStatusBar
        activeConn={activeConn}
        activeTab={activeTab}
        connectedIds={connectedIds}
        connStatus={connStatus}
        activeResult={activeResult}
        activeResultError={activeResultError}
        isRunning={isRunning}
      />

      {pendingCloseTab && (
        <UnsavedQueryDialog
          queryName={pendingCloseTab.title}
          onCancel={() => setPendingCloseTabId(null)}
          onDiscardAndClose={() => {
            closeTab(pendingCloseTab.id);
            setPendingCloseTabId(null);
          }}
          onSaveAndClose={() => {
            void (async () => {
              const ok = await persistTabSavedQuery(pendingCloseTab);
              if (!ok) return;
              closeTab(pendingCloseTab.id);
              setPendingCloseTabId(null);
            })();
          }}
        />
      )}

      {renameTargetTab?.savedQueryId && (
        <RenameQueryDialog
          initialName={renameTargetTab.title}
          onClose={() => setRenameTabId(null)}
          onConfirm={(name) => void confirmRenameSavedQuery(name)}
        />
      )}

      {aboutOpen && <AboutDialog info={appInfo} onClose={() => setAboutOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {tipsOpen && <KeyboardTipsDialog onClose={() => setTipsOpen(false)} />}
      <QuickSearchDialog
        open={quickSearchOpen}
        tabs={tabs}
        tables={tables}
        savedQueries={savedQueries}
        connections={connections}
        onClose={() => setQuickSearchOpen(false)}
        onSelectTab={selectTab}
        onOpenTable={openTableViewTab}
        onOpenSavedQuery={openSavedQuery}
        onOpenConnectionInNewTab={(conn) => openQueryTab(conn.id, '', { forceNew: true })}
      />

      {connPickerOpen && (
        <ConnectionPickerMenu
          connections={connections}
          anchorRef={addTabBtnRef}
          onPick={openNewTabForConnection}
          onClose={() => setConnPickerOpen(false)}
        />
      )}

      <AppDialogHost />
      <AppTooltipLayer />
      <AppToastLayer />
    </div>
  );
}

export default App;
