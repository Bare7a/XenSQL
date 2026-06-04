import { memo } from 'react';
import { SqlEditor } from '@/features/editor/SqlEditor';
import { isSavedQueryTabDirty } from '@/features/editor/lib/savedQueryTab';
import type {
  ColumnInfo,
  ConnectionConfig,
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
  loadColumnsForConnection: (
    connectionId: string
  ) => (schema: string, table: string) => Promise<ColumnInfo[]>;
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
        const isActive = tab.id === activeTabId;
        const conn = connections.find((c) => c.id === tab.connectionId);
        const tabDirty = !!tab.savedQueryId && isSavedQueryTabDirty(tab);
        return (
          <div
            key={tab.id}
            className={`tab-editor-layer${isActive ? ' tab-layer-active' : ''}`}
          >
            <SqlEditor
              tabId={tab.id}
              isActive={isActive}
              cursorState={tab.editorCursor}
              onCursorStateChange={(cursor) => onCursorStateChange(tab.id, cursor)}
              connectionId={tab.connectionId}
              driver={conn?.driver ?? 'postgres'}
              sql={tab.sql}
              color={tab.color}
              onChange={(sql) => onChangeSql(tab.id, sql)}
              onRun={(sql) => onRun(tab.id, sql)}
              isQueryRunning={runningTabId === tab.id}
              onCancelQuery={() => onCancel(tab.id)}
              savedQueryId={tab.savedQueryId}
              savedQueryName={tab.savedQueryId ? tab.title : undefined}
              onSaveQuery={isActive ? onSaveQuery : undefined}
              isSavedQueryDirty={tabDirty}
              onRenameSavedQuery={
                isActive && tab.savedQueryId ? onRenameSavedQuery : undefined
              }
              txnState={tabTxnStates[tab.id]}
              onBeginTxn={conn?.readOnly ? undefined : () => onBeginTxn(tab.id)}
              onCommitTxn={() => onCommitTxn(tab.id)}
              onRollbackTxn={() => onRollbackTxn(tab.id)}
              schemas={schemas[tab.connectionId] || []}
              allTables={tablesForConnection(tab.connectionId)}
              onLoadColumns={loadColumnsForConnection(tab.connectionId)}
            />
          </div>
        );
      })}
    </div>
  );
});
