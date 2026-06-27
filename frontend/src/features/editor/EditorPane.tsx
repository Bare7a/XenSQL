import { memo, useCallback, useMemo } from 'react';
import { SqlEditor } from '@/features/editor/SqlEditor';
import type {
  ColumnInfo,
  ConnectionConfig,
  DriverType,
  EditorCursorState,
  EditorTab,
  SchemaInfo,
  TableInfo,
  TxnState,
} from '@/types';

interface EditorPaneProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  connections: ConnectionConfig[];
  runningTabId: string | null;
  schemas: Record<string, SchemaInfo[]>;
  tablesForConnection: (connectionId: string) => TableInfo[];
  loadColumnsForConnection: (connectionId: string) => (schema: string, table: string) => Promise<ColumnInfo[]>;
  onChangeSql: (tabId: string, sql: string) => void;
  onRun: (tabId: string, sql: string) => void;
  onCancel: (tabId: string) => void;
  onSaveQuery: () => void;
  onRenameSavedQuery: () => void;
  onCursorStateChange: (tabId: string, cursor: EditorCursorState) => void;
  tabTxnStates: Record<string, TxnState>;
  onBeginTxn: (tabId: string) => void;
  onCommitTxn: (tabId: string) => void;
  onRollbackTxn: (tabId: string) => void;
}

// Stable ref so a schema-less connection doesn't hand the editor a fresh [] each render.
const EMPTY_SCHEMAS: SchemaInfo[] = [];

interface EditorPaneTabProps {
  tab: EditorTab;
  isActive: boolean;
  driver: DriverType;
  readOnly: boolean;
  isQueryRunning: boolean;
  schemas: SchemaInfo[];
  allTables: TableInfo[];
  txnState?: TxnState;
  loadColumnsForConnection: EditorPaneProps['loadColumnsForConnection'];
  onChangeSql: EditorPaneProps['onChangeSql'];
  onRun: EditorPaneProps['onRun'];
  onCancel: EditorPaneProps['onCancel'];
  onSaveQuery: EditorPaneProps['onSaveQuery'];
  onRenameSavedQuery: EditorPaneProps['onRenameSavedQuery'];
  onCursorStateChange: EditorPaneProps['onCursorStateChange'];
  onBeginTxn: EditorPaneProps['onBeginTxn'];
  onCommitTxn: EditorPaneProps['onCommitTxn'];
  onRollbackTxn: EditorPaneProps['onRollbackTxn'];
}

// Memoized per-tab wrapper binding the stable App callbacks to this tab.id, so editing one tab
// doesn't re-render the others' editors. Inline bindings in the parent map would defeat the memo.
const EditorPaneTab = memo(function EditorPaneTab({
  tab,
  isActive,
  driver,
  readOnly,
  isQueryRunning,
  schemas,
  allTables,
  txnState,
  loadColumnsForConnection,
  onChangeSql,
  onRun,
  onCancel,
  onSaveQuery,
  onRenameSavedQuery,
  onCursorStateChange,
  onBeginTxn,
  onCommitTxn,
  onRollbackTxn,
}: EditorPaneTabProps) {
  const tabId = tab.id;
  const connectionId = tab.connectionId;

  const onLoadColumns = useMemo(() => loadColumnsForConnection(connectionId), [loadColumnsForConnection, connectionId]);

  const handleChange = useCallback((sql: string) => onChangeSql(tabId, sql), [onChangeSql, tabId]);
  const handleRun = useCallback((sql: string) => onRun(tabId, sql), [onRun, tabId]);
  const handleCancel = useCallback(() => onCancel(tabId), [onCancel, tabId]);
  const handleCursorStateChange = useCallback(
    (cursor: EditorCursorState) => onCursorStateChange(tabId, cursor),
    [onCursorStateChange, tabId],
  );
  const handleBeginTxn = useCallback(() => onBeginTxn(tabId), [onBeginTxn, tabId]);
  const handleCommitTxn = useCallback(() => onCommitTxn(tabId), [onCommitTxn, tabId]);
  const handleRollbackTxn = useCallback(() => onRollbackTxn(tabId), [onRollbackTxn, tabId]);

  return (
    <div className={`tab-editor-layer${isActive ? ' tab-layer-active' : ''}`}>
      <SqlEditor
        tabId={tabId}
        isActive={isActive}
        cursorState={tab.editorCursor}
        onCursorStateChange={handleCursorStateChange}
        connectionId={connectionId}
        driver={driver}
        sql={tab.sql}
        color={tab.color}
        onChange={handleChange}
        onRun={handleRun}
        isQueryRunning={isQueryRunning}
        onCancelQuery={handleCancel}
        savedQueryId={tab.savedQueryId}
        onSaveQuery={isActive ? onSaveQuery : undefined}
        onRenameSavedQuery={isActive && tab.savedQueryId ? onRenameSavedQuery : undefined}
        txnState={txnState}
        onBeginTxn={readOnly ? undefined : handleBeginTxn}
        onCommitTxn={handleCommitTxn}
        onRollbackTxn={handleRollbackTxn}
        schemas={schemas}
        allTables={allTables}
        onLoadColumns={onLoadColumns}
      />
    </div>
  );
});

// Inactive editors are hidden via CSS (not unmounted) so cursor/undo history survives tab switches.
export const EditorPane = memo(function EditorPane({
  tabs,
  activeTabId,
  connections,
  runningTabId,
  schemas,
  tablesForConnection,
  loadColumnsForConnection,
  onChangeSql,
  onRun,
  onCancel,
  onSaveQuery,
  onRenameSavedQuery,
  onCursorStateChange,
  tabTxnStates,
  onBeginTxn,
  onCommitTxn,
  onRollbackTxn,
}: EditorPaneProps) {
  return (
    <div className="editor-upper">
      {tabs.map((tab) => {
        const conn = connections.find((c) => c.id === tab.connectionId);
        return (
          <EditorPaneTab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            driver={conn?.driver ?? 'postgres'}
            readOnly={!!conn?.readOnly}
            isQueryRunning={runningTabId === tab.id}
            schemas={schemas[tab.connectionId] || EMPTY_SCHEMAS}
            allTables={tablesForConnection(tab.connectionId)}
            txnState={tabTxnStates[tab.id]}
            loadColumnsForConnection={loadColumnsForConnection}
            onChangeSql={onChangeSql}
            onRun={onRun}
            onCancel={onCancel}
            onSaveQuery={onSaveQuery}
            onRenameSavedQuery={onRenameSavedQuery}
            onCursorStateChange={onCursorStateChange}
            onBeginTxn={onBeginTxn}
            onCommitTxn={onCommitTxn}
            onRollbackTxn={onRollbackTxn}
          />
        );
      })}
    </div>
  );
});
