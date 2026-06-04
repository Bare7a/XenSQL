import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api, newTabId } from '@/shared/lib/api';
import { appError, appPrompt } from '@/shared/lib/appDialog';
import { findTabForSavedQuery } from '@/features/editor/lib/savedQueryTab';
import {
  useActiveTab,
  useConnections,
  useSavedQueries,
  useSelectedConnectionId,
  useStoreActions,
  useTabs,
} from '@/store/selectors';
import type { EditorTab, SavedQuery } from '@/types';

export function useSavedQueryActions(
  renameTabId: string | null,
  setRenameTabId: (id: string | null) => void
) {
  const { t } = useTranslation();
  const connections = useConnections();
  const tabs = useTabs();
  const activeTab = useActiveTab();
  const selectedConnectionId = useSelectedConnectionId();
  const savedQueries = useSavedQueries();
  const { addTab, updateTab, setActiveTab, setSelectedConnection, setSavedQueries } =
    useStoreActions();

  const persistTabSavedQuery = useCallback(
    async (tab: EditorTab): Promise<boolean> => {
      if (!tab.savedQueryId) return false;
      try {
        const prev = savedQueries.find((q) => q.id === tab.savedQueryId);
        const saved = await api.saveSavedQuery({
          id: tab.savedQueryId,
          name: tab.title,
          connectionId: tab.connectionId,
          sql: tab.sql,
          createdAt: prev?.createdAt ?? '',
          updatedAt: '',
        });
        updateTab(tab.id, { savedSqlBaseline: tab.sql });
        setSavedQueries(savedQueries.map((q) => (q.id === saved.id ? saved : q)));
        return true;
      } catch (err) {
        void appError(err, t('errors.saveQueryFailed'));
        return false;
      }
    },
    [savedQueries, setSavedQueries, updateTab, t]
  );

  const handleSaveQuery = useCallback(async () => {
    if (!activeTab) return;
    if (activeTab.savedQueryId) {
      await persistTabSavedQuery(activeTab);
      return;
    }
    const name = await appPrompt({
      title: t('dialog.saveQueryTitle'),
      description: t('dialog.saveQueryDescription'),
      label: t('dialog.queryNameLabel'),
      placeholder: t('dialog.queryNamePlaceholder'),
      confirmLabel: t('common.save'),
    });
    if (!name) return;
    try {
      const saved = await api.saveSavedQuery({
        id: '',
        name: name.trim(),
        connectionId: activeTab.connectionId,
        sql: activeTab.sql,
        createdAt: '',
        updatedAt: '',
      });
      updateTab(activeTab.id, {
        savedQueryId: saved.id,
        title: saved.name,
        savedSqlBaseline: activeTab.sql,
      });
      setSavedQueries([saved, ...savedQueries.filter((q) => q.id !== saved.id)]);
    } catch (err) {
      void appError(err, t('errors.saveQueryFailed'));
    }
  }, [activeTab, savedQueries, setSavedQueries, updateTab, persistTabSavedQuery, t]);

  const openRenameDialog = useCallback(() => {
    if (!activeTab?.savedQueryId) return;
    setRenameTabId(activeTab.id);
  }, [activeTab, setRenameTabId]);

  const confirmRenameSavedQuery = useCallback(
    async (name: string) => {
      const tab = tabs.find((tab) => tab.id === renameTabId);
      if (!tab?.savedQueryId || name === tab.title) {
        setRenameTabId(null);
        return;
      }
      const prev = savedQueries.find((q) => q.id === tab.savedQueryId);
      if (!prev) {
        setRenameTabId(null);
        return;
      }
      try {
        const saved = await api.saveSavedQuery({ ...prev, name });
        updateTab(tab.id, { title: saved.name });
        setSavedQueries(savedQueries.map((q) => (q.id === saved.id ? saved : q)));
      } catch (err) {
        void appError(err, t('errors.renameQueryFailed'));
      } finally {
        setRenameTabId(null);
      }
    },
    [renameTabId, tabs, savedQueries, setSavedQueries, updateTab, setRenameTabId, t]
  );

  const openSavedQuery = useCallback(
    (saved: SavedQuery) => {
      const connectionId =
        saved.connectionId || selectedConnectionId || activeTab?.connectionId || connections[0]?.id;
      if (!connectionId) return;
      const conn = connections.find((c) => c.id === connectionId);
      if (!conn) return;
      setSelectedConnection(connectionId);

      const existing = findTabForSavedQuery(tabs, saved);
      if (existing) {
        updateTab(existing.id, {
          sql: saved.sql,
          title: saved.name,
          connectionId,
          savedQueryId: saved.id,
          savedSqlBaseline: saved.sql,
        });
        setActiveTab(existing.id);
        return;
      }

      addTab({
        id: newTabId(),
        connectionId,
        title: saved.name,
        sql: saved.sql,
        color: conn.color,
        savedQueryId: saved.id,
        savedSqlBaseline: saved.sql,
      });
    },
    [connections, tabs, selectedConnectionId, activeTab, addTab, updateTab, setActiveTab, setSelectedConnection]
  );

  return {
    persistTabSavedQuery,
    handleSaveQuery,
    openRenameDialog,
    confirmRenameSavedQuery,
    openSavedQuery,
  };
}
