import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store/appStore';
import { emptyTabSession, type TabSessionState } from '@/types';

// Frozen sentinel - zustand's useSyncExternalStore crashes if a selector returns a new object each call
const EMPTY_SESSION: TabSessionState = Object.freeze(emptyTabSession());

export const useConnections = () => useAppStore((s) => s.connections);
export const useConnectedIds = () => useAppStore((s) => s.connectedIds);
export const useSchemas = () => useAppStore((s) => s.schemas);
export const useTablesMap = () => useAppStore((s) => s.tables);
export const useTabs = () => useAppStore((s) => s.tabs);
export const useActiveTabId = () => useAppStore((s) => s.activeTabId);
export const useRunningTabId = () => useAppStore((s) => s.runningTabId);
export const useSavedQueries = () => useAppStore((s) => s.savedQueries);
export const useSelectedConnectionId = () => useAppStore((s) => s.selectedConnectionId);
export const useFolders = () => useAppStore((s) => s.folders);
/** Use when a component needs sessions for inactive tabs that stay mounted. */
export const useTabSessionMap = () => useAppStore((s) => s.tabSession);

export const useActiveTab = () => useAppStore(useShallow((s) => s.tabs.find((t) => t.id === s.activeTabId)));

export const useActiveTabSession = (): TabSessionState =>
  useAppStore((s) => {
    const id = s.activeTabId;
    return (id ? s.tabSession[id] : undefined) ?? EMPTY_SESSION;
  });

// The connection in context: explicit selection, else the active tab's, else the first connection.
export const useResolvedConnectionId = (): string | null =>
  useAppStore((s) => {
    const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
    return s.selectedConnectionId || activeTab?.connectionId || s.connections[0]?.id || null;
  });

export const useStoreActions = () =>
  useAppStore(
    useShallow((s) => ({
      setConnections: s.setConnections,
      reorderConnections: s.reorderConnections,
      setFolders: s.setFolders,
      setConnected: s.setConnected,
      setSchemas: s.setSchemas,
      setTables: s.setTables,
      clearConnectionCache: s.clearConnectionCache,
      setTabs: s.setTabs,
      setActiveTab: s.setActiveTab,
      addTab: s.addTab,
      updateTab: s.updateTab,
      closeTab: s.closeTab,
      updateTabSession: s.updateTabSession,
      setRunningTab: s.setRunningTab,
      setHistory: s.setHistory,
      setSavedQueries: s.setSavedQueries,
      reorderTabs: s.reorderTabs,
      setSidebarView: s.setSidebarView,
      setSelectedConnection: s.setSelectedConnection,
    })),
  );
