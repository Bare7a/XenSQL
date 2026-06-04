import { memo } from 'react';
import { ResultsGrid } from '@/features/results/ResultsGrid';
import { ResultTabs } from '@/features/results/ResultTabs';
import { useAppStore } from '@/store/appStore';
import { emptyTabSession } from '@/types';
import type { ConnectionConfig, EditorTab, TabSessionState } from '@/types';

interface ResultsPaneProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  connections: ConnectionConfig[];
  tabSession: Record<string, TabSessionState>;
  onRefreshTable?: (
    connectionId: string,
    schema: string,
    table: string,
    tabId: string
  ) => void;
  onFocusedRowChange: (
    tabId: string,
    row: Record<string, unknown> | null
  ) => void;
}

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
        const isActive = tab.id === activeTabId;
        const session = tabSession[tab.id] ?? emptyTabSession();
        const conn = connections.find((c) => c.id === tab.connectionId);
        const tabReadOnly = !!conn?.readOnly;
        const tabDataBrowser = session.dataBrowser;
        return (
          <div
            key={tab.id}
            className={`tab-results-layer${isActive ? ' tab-layer-active' : ''}`}
          >
            <ResultTabs
              results={session.results}
              activeIndex={session.activeResultIndex}
              onSelect={(index) => useAppStore.getState().setActiveResultIndex(tab.id, index)}
            />
            <ResultsGrid
              // Remount on result-set switch: sets share a streamId, so a key change is what resets
              // the grid's columns/selection/scroll between them.
              key={session.activeResultIndex}
              connectionId={tab.connectionId}
              result={session.result}
              error={session.resultError}
              readOnly={tabReadOnly}
              tableMode={tabDataBrowser || undefined}
              isActive={isActive}
              onRefresh={
                tabDataBrowser && onRefreshTable
                  ? () =>
                      onRefreshTable(
                        tab.connectionId,
                        tabDataBrowser.schema,
                        tabDataBrowser.table,
                        tab.id
                      )
                  : undefined
              }
              onFocusedRowChange={(row) => onFocusedRowChange(tab.id, row)}
            />
          </div>
        );
      })}
    </>
  );
});
