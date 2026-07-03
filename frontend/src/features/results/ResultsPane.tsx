import { memo, useCallback } from 'react';
import { ResultsGrid } from '@/features/results/ResultsGrid';
import { ResultTabs } from '@/features/results/ResultTabs';
import { useAppStore } from '@/store/appStore';
import type { ConnectionConfig, EditorTab, TabSessionState } from '@/types';
import { emptyTabSession } from '@/types';

interface ResultsPaneProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  connections: ConnectionConfig[];
  tabSession: Record<string, TabSessionState>;
  onRefreshTable?: (connectionId: string, schema: string, table: string, tabId: string) => void;
  onFocusedRowChange: (tabId: string, row: Record<string, unknown> | null) => void;
}

// Stable empty-session reference for tabs not yet in tabSession.
const EMPTY_SESSION: TabSessionState = Object.freeze(emptyTabSession());

interface ResultsPaneTabProps {
  tabId: string;
  connectionId: string;
  isActive: boolean;
  session: TabSessionState;
  readOnly: boolean;
  onRefreshTable?: ResultsPaneProps['onRefreshTable'];
  onFocusedRowChange: ResultsPaneProps['onFocusedRowChange'];
}

// Memoized per tab: stable callbacks + inactive tabs skip re-render during streaming.
const ResultsPaneTab = memo(function ResultsPaneTab({
  tabId,
  connectionId,
  isActive,
  session,
  readOnly,
  onRefreshTable,
  onFocusedRowChange,
}: ResultsPaneTabProps) {
  const dataBrowser = session.dataBrowser;

  const handleSelectResult = useCallback(
    (index: number) => useAppStore.getState().setActiveResultIndex(tabId, index),
    [tabId],
  );

  const handleFocusedRowChange = useCallback(
    (row: Record<string, unknown> | null) => onFocusedRowChange(tabId, row),
    [onFocusedRowChange, tabId],
  );

  const handleRefresh = useCallback(() => {
    if (dataBrowser && onRefreshTable) {
      onRefreshTable(connectionId, dataBrowser.schema, dataBrowser.table, tabId);
    }
  }, [dataBrowser, onRefreshTable, connectionId, tabId]);

  // One grid per result set, hidden via CSS, so per-set grid state survives result-tab switches.
  const runKey = session.runStreamId ?? 'direct';

  return (
    <div className={`tab-results-layer${isActive ? ' tab-layer-active' : ''}`}>
      <ResultTabs results={session.results} activeIndex={session.activeResultIndex} onSelect={handleSelectResult} />
      {session.results.length === 0 ? (
        <div className="result-set-layer tab-layer-active">
          <ResultsGrid
            connectionId={connectionId}
            result={session.result}
            error={session.resultError}
            errorInfo={session.resultErrorInfo}
            errorStatement={null}
            readOnly={readOnly}
            tableMode={dataBrowser || undefined}
            isActive={isActive}
            onRefresh={dataBrowser && onRefreshTable ? handleRefresh : undefined}
            onFocusedRowChange={handleFocusedRowChange}
          />
        </div>
      ) : (
        session.results.map((set, i) => {
          const setActive = i === session.activeResultIndex;
          return (
            <div key={`${runKey}-${i}`} className={`result-set-layer${setActive ? ' tab-layer-active' : ''}`}>
              <ResultsGrid
                connectionId={connectionId}
                result={set.result}
                error={set.error}
                errorInfo={set.errorInfo}
                errorStatement={set.statement ?? null}
                readOnly={readOnly}
                tableMode={dataBrowser || undefined}
                isActive={isActive && setActive}
                onRefresh={dataBrowser && onRefreshTable ? handleRefresh : undefined}
                onFocusedRowChange={handleFocusedRowChange}
              />
            </div>
          );
        })
      )}
    </div>
  );
});

// One ResultsGrid per tab keeps per-tab state (focus, scroll, sort, selection) alive across tab switches.
export const ResultsPane = memo(function ResultsPane({
  tabs,
  activeTabId,
  connections,
  tabSession,
  onRefreshTable,
  onFocusedRowChange,
}: ResultsPaneProps) {
  return (
    <>
      {tabs.map((tab) => {
        const conn = connections.find((c) => c.id === tab.connectionId);
        return (
          <ResultsPaneTab
            key={tab.id}
            tabId={tab.id}
            connectionId={tab.connectionId}
            isActive={tab.id === activeTabId}
            session={tabSession[tab.id] ?? EMPTY_SESSION}
            readOnly={!!conn?.readOnly}
            onRefreshTable={onRefreshTable}
            onFocusedRowChange={onFocusedRowChange}
          />
        );
      })}
    </>
  );
});
