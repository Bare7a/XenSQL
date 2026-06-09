import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useTransactionActions } from '@/features/editor/hooks/useTransactionActions';
import { detectTransactionControl, type TxnControlAction } from '@/features/editor/lib/transactionControl';
import { api } from '@/shared/lib/api';
import { useStoreActions, useTabs } from '@/store/selectors';
import type { QueryResult } from '@/types';

// Two RAFs: Wails webview sometimes coalesces a single rAF with the next paint
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

const TXN_MESSAGE_KEY: Record<TxnControlAction, string> = {
  begin: 'results.txnBegin',
  commit: 'results.txnCommit',
  rollback: 'results.txnRollback',
};

// A confirmation result for a transaction-control statement: no grid, just a message.
function txnResult(message: string): QueryResult {
  return {
    columns: [],
    columnTypes: [],
    rows: [],
    rowCount: 0,
    affectedRows: 0,
    durationMs: 0,
    message,
  };
}

export function useQueryRunner() {
  const tabs = useTabs();
  const { t } = useTranslation();
  const { setRunningTab, updateTabSession } = useStoreActions();
  const { beginTransaction, commitTransaction, rollbackTransaction } = useTransactionActions();

  const runQueryForTab = useCallback(
    async (tabId: string, sql: string) => {
      const tab = tabs.find((tab) => tab.id === tabId);
      if (!tab) return;

      // Running a lone BEGIN/COMMIT/ROLLBACK drives the tab's pinned transaction (and badge)
      // instead of executing raw on a pooled/pinned connection, which would desync the state.
      const txnControl = detectTransactionControl(sql);
      if (txnControl) {
        const dispatch =
          txnControl === 'begin' ? beginTransaction : txnControl === 'commit' ? commitTransaction : rollbackTransaction;
        const ok = await dispatch(tabId);
        if (ok) {
          updateTabSession(tabId, {
            result: txnResult(t(TXN_MESSAGE_KEY[txnControl])),
            resultError: null,
            dataBrowser: null,
          });
        }
        return;
      }

      setRunningTab(tabId);
      updateTabSession(tabId, { result: null, resultError: null, dataBrowser: null });
      await yieldToUi();
      try {
        await api.executeQueryStream(tab.connectionId, tabId, sql);
      } catch (e) {
        updateTabSession(tabId, { result: null, resultError: String(e) });
        setRunningTab(null);
      }
    },
    [tabs, setRunningTab, updateTabSession, beginTransaction, commitTransaction, rollbackTransaction, t],
  );

  const cancelQueryForTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((tab) => tab.id === tabId);
      if (!tab) return;
      void api.cancelQuery(tab.connectionId);
    },
    [tabs],
  );

  return { runQueryForTab, cancelQueryForTab };
}
