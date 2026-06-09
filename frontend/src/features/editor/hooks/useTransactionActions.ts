import { useCallback } from 'react';
import { api } from '@/shared/lib/api';
import { useStoreActions, useTabs } from '@/store/selectors';

export function useTransactionActions() {
  const tabs = useTabs();
  const { updateTabSession } = useStoreActions();

  // The actions return whether the operation succeeded so callers (e.g. running BEGIN/COMMIT/ROLLBACK
  // as SQL) can show confirmation without clobbering an error message set here on failure.
  const beginTransaction = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return false;
      try {
        await api.beginTransaction(tab.connectionId, tabId);
        updateTabSession(tabId, { txnState: 'active' });
        return true;
      } catch (e) {
        // Begin failed - no transaction was opened, so leave txnState as-is and surface why.
        updateTabSession(tabId, { resultError: String(e) });
        return false;
      }
    },
    [tabs, updateTabSession],
  );

  // Commit and rollback release the pinned connection on the backend whether or not the SQL
  // succeeds, so the tab always leaves the active state; on failure we also surface the error.
  const commitTransaction = useCallback(
    async (tabId: string): Promise<boolean> => {
      let ok = false;
      try {
        await api.commitTransaction(tabId);
        ok = true;
      } catch (e) {
        updateTabSession(tabId, { resultError: String(e) });
      } finally {
        updateTabSession(tabId, { txnState: 'idle' });
      }
      return ok;
    },
    [updateTabSession],
  );

  const rollbackTransaction = useCallback(
    async (tabId: string): Promise<boolean> => {
      let ok = false;
      try {
        await api.rollbackTransaction(tabId);
        ok = true;
      } catch (e) {
        updateTabSession(tabId, { resultError: String(e) });
      } finally {
        updateTabSession(tabId, { txnState: 'idle' });
      }
      return ok;
    },
    [updateTabSession],
  );

  const cleanupTabTransaction = useCallback(
    async (tabId: string) => {
      // Fired as the tab closes; nothing actionable to surface if it fails.
      try {
        await api.cleanupTabTransaction(tabId);
      } finally {
        updateTabSession(tabId, { txnState: 'idle' });
      }
    },
    [updateTabSession],
  );

  return { beginTransaction, commitTransaction, rollbackTransaction, cleanupTabTransaction };
}
