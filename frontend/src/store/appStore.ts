import { create } from 'zustand';
import { api } from '@/shared/lib/api';
import { normalizeQueryResult, uniquifyColumns } from '@/shared/lib/normalize';
import type {
  ConnectionConfig,
  ConnectionFolder,
  EditorTab,
  HistoryEntry,
  QueryResult,
  ResultSet,
  SavedQuery,
  SchemaInfo,
  TableInfo,
  TabSessionState,
} from '@/types';
import { emptyTabSession } from '@/types';

// Stream ids are monotonic decimal counters; compare numerically (lexical "9" > "10" would be wrong).
function streamIdLessThan(a: string, b: string): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return na < nb;
}

// result/resultError mirror the active result set so single-result readers (grid, table view,
// export) keep working without knowing about the results array.
function withActiveMirror(session: TabSessionState): TabSessionState {
  const active = session.results[session.activeResultIndex];
  return { ...session, result: active?.result ?? null, resultError: active?.error ?? null };
}

// runFor returns the session ready to receive an event for streamId: unchanged for the current run,
// reset for a newer run (higher streamId), or null when the event is from a superseded run (drop it).
function runFor(session: TabSessionState, streamId: string): TabSessionState | null {
  if (session.runStreamId === streamId) return session;
  if (session.runStreamId != null && streamIdLessThan(streamId, session.runStreamId)) return null;
  return {
    ...session,
    runStreamId: streamId,
    results: [],
    activeResultIndex: 0,
    result: null,
    resultError: null,
    dataBrowser: null,
  };
}

// setResultAt returns a copy of results with index set, padding gaps with empty placeholders.
function setResultAt(results: ResultSet[], index: number, set: ResultSet): ResultSet[] {
  const next = results.slice();
  while (next.length <= index) next.push({ result: null, error: null });
  next[index] = set;
  return next;
}

interface AppState {
  connections: ConnectionConfig[];
  folders: ConnectionFolder[];
  connectedIds: Record<string, boolean>;
  schemas: Record<string, SchemaInfo[]>;
  tables: Record<string, TableInfo[]>;
  tabs: EditorTab[];
  activeTabId: string | null;
  tabSession: Record<string, TabSessionState>;
  runningTabId: string | null;
  history: HistoryEntry[];
  savedQueries: SavedQuery[];
  sidebarView: 'schema' | 'queries';
  selectedConnectionId: string | null;

  setConnections: (c: ConnectionConfig[]) => void;
  reorderConnections: (fromId: string, toId: string) => void;
  setFolders: (f: ConnectionFolder[]) => void;
  setConnected: (id: string, connected: boolean) => void;
  setSchemas: (connId: string, schemas: SchemaInfo[]) => void;
  setTables: (key: string, tables: TableInfo[]) => void;
  setTabs: (tabs: EditorTab[]) => void;
  setActiveTab: (id: string | null) => void;
  addTab: (tab: EditorTab) => void;
  updateTab: (id: string, patch: Partial<EditorTab>) => void;
  closeTab: (id: string) => void;
  updateTabSession: (id: string, patch: Partial<TabSessionState>) => void;
  /** Begins a result set (meta event). A higher streamId starts a fresh run, resetting results. */
  startResultSet: (
    tabId: string,
    meta: {
      streamId: string;
      resultIndex: number;
      columns: string[];
      columnTypes: string[];
      schemaName?: string;
      tableName?: string;
    },
  ) => void;
  /** Appends streamed rows to one result set; drops events from a superseded run. */
  appendResultRows: (tabId: string, streamId: string, resultIndex: number, rows: unknown[][]) => void;
  /** Finalizes one result set (result event) with summary metadata or a per-statement error. */
  finalizeResultSet: (
    tabId: string,
    streamId: string,
    resultIndex: number,
    result: QueryResult | null,
    statement: string | null,
    error: string | null,
  ) => void;
  /** Terminates a run (done event): clears the running indicator and surfaces a batch-level error. */
  finishRun: (
    tabId: string,
    streamId: string,
    resultCount: number,
    error: string | null,
    opts?: { connectionId?: string; markConnected?: boolean },
  ) => void;
  setActiveResultIndex: (tabId: string, index: number) => void;
  getTabSession: (id: string) => TabSessionState;
  setRunningTab: (id: string | null) => void;
  setHistory: (h: HistoryEntry[]) => void;
  setSavedQueries: (q: SavedQuery[]) => void;
  reorderTabs: (fromId: string, toId: string) => void;
  setSidebarView: (v: AppState['sidebarView']) => void;
  setSelectedConnection: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  connections: [],
  folders: [],
  connectedIds: {},
  schemas: {},
  tables: {},
  tabs: [],
  activeTabId: null,
  tabSession: {},
  runningTabId: null,
  history: [],
  savedQueries: [],
  sidebarView: 'schema',
  selectedConnectionId: null,

  setConnections: (connections) => set({ connections }),
  reorderConnections: (fromId, toId) => {
    if (fromId === toId) return;
    const connections = [...get().connections];
    const fromIdx = connections.findIndex((c) => c.id === fromId);
    const toIdx = connections.findIndex((c) => c.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = connections.splice(fromIdx, 1);
    connections.splice(toIdx, 0, moved);
    set({ connections });
    const orderedIds = connections.map((c) => c.id);
    void api.reorderConnections(orderedIds).catch(() => {
      void api.listConnections().then((list) => set({ connections: list }));
    });
  },
  setFolders: (folders) => set({ folders }),
  setConnected: (id, connected) => {
    const next = { ...get().connectedIds };
    if (connected) next[id] = true;
    else delete next[id];
    set({ connectedIds: next });
  },
  setSchemas: (connId, schemas) => set((s) => ({ schemas: { ...s.schemas, [connId]: schemas } })),
  setTables: (key, tables) => set((s) => ({ tables: { ...s.tables, [key]: tables } })),
  setTabs: (tabs) => set({ tabs }),
  setActiveTab: (activeTabId) => set({ activeTabId }),
  addTab: (tab) => {
    const tabs = [...get().tabs, tab];
    set({ tabs, activeTabId: tab.id });
  },
  updateTab: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  closeTab: (id) => {
    const tabs = get().tabs.filter((t) => t.id !== id);
    let activeTabId = get().activeTabId;
    if (activeTabId === id) {
      activeTabId = tabs.length ? tabs[tabs.length - 1].id : null;
    }
    const tabSession = { ...get().tabSession };
    delete tabSession[id];
    const runningTabId = get().runningTabId === id ? null : get().runningTabId;
    set({ tabs, activeTabId, tabSession, runningTabId });
  },
  // Guard: stream:done after closeTab would otherwise resurrect the session and pin result rows
  updateTabSession: (id, patch) =>
    set((s) => {
      const tabStillOpen = s.tabs.some((t) => t.id === id);
      const sessionExists = s.tabSession[id] != null;
      if (!tabStillOpen && !sessionExists) return s;
      const next = { ...(s.tabSession[id] ?? emptyTabSession()), ...patch };
      // A caller setting result/resultError directly (txn message, a thrown error, the pre-run
      // clear) is the displayed result, so reflect it as a single result set to keep the
      // multi-result state consistent. The streaming actions manage results[] themselves.
      if ('result' in patch || 'resultError' in patch) {
        const r = 'result' in patch ? (patch.result ?? null) : next.result;
        const e = 'resultError' in patch ? (patch.resultError ?? null) : next.resultError;
        next.activeResultIndex = 0;
        if (e != null) {
          next.results = [{ result: null, error: e }];
          next.result = null;
          next.resultError = e;
        } else if (r != null) {
          next.results = [{ result: r, error: null }];
          next.result = r;
          next.resultError = null;
        } else {
          next.results = [];
          next.result = null;
          next.resultError = null;
        }
      }
      return { tabSession: { ...s.tabSession, [id]: next } };
    }),
  startResultSet: (tabId, meta) =>
    set((s) => {
      const tabStillOpen = s.tabs.some((t) => t.id === tabId);
      const sessionExists = s.tabSession[tabId] != null;
      if (!tabStillOpen && !sessionExists) return s;
      const run = runFor(s.tabSession[tabId] ?? emptyTabSession(), meta.streamId);
      if (run == null) return s; // event from a superseded run
      const tab = s.tabs.find((t) => t.id === tabId);
      const dataBrowser =
        tab?.tableView != null
          ? { schema: tab.tableView.schema, table: tab.tableView.table }
          : meta.schemaName && meta.tableName
            ? { schema: meta.schemaName, table: meta.tableName }
            : run.dataBrowser;
      const result: QueryResult = {
        columns: uniquifyColumns(meta.columns),
        columnTypes: meta.columnTypes,
        rows: [],
        rowCount: 0,
        affectedRows: 0,
        durationMs: 0,
        schemaName: meta.schemaName,
        tableName: meta.tableName,
        streamId: meta.streamId,
        streaming: true,
      };
      const results = setResultAt(run.results, meta.resultIndex, { result, error: null });
      return {
        tabSession: { ...s.tabSession, [tabId]: withActiveMirror({ ...run, results, dataBrowser }) },
        // Re-assert the running indicator: a late `done` from a superseded query on this tab may
        // have cleared it before this query's meta arrived.
        runningTabId: tabStillOpen ? tabId : s.runningTabId,
      };
    }),
  // Mutate rows in-place then swap result reference - O(N) not O(N²); concat/spread copies all prior rows per batch
  appendResultRows: (tabId, streamId, resultIndex, rows) =>
    set((s) => {
      const session = s.tabSession[tabId];
      if (!session || session.runStreamId !== streamId) return s;
      const target = session.results[resultIndex];
      const existing = target?.result;
      // Drop rows for a stale stream or arriving after finalise - either would inflate a completed rowCount.
      if (!existing || existing.streamId !== streamId || !existing.streaming) return s;
      const arr = existing.rows ?? [];
      for (let i = 0; i < rows.length; i++) arr.push(rows[i]);
      const nextResult: QueryResult = { ...existing, rows: arr, rowCount: arr.length };
      const results = setResultAt(session.results, resultIndex, { ...target, result: nextResult });
      return {
        tabSession: { ...s.tabSession, [tabId]: withActiveMirror({ ...session, results }) },
      };
    }),
  finalizeResultSet: (tabId, streamId, resultIndex, result, statement, error) =>
    set((s) => {
      const tabStillOpen = s.tabs.some((t) => t.id === tabId);
      const sessionExists = s.tabSession[tabId] != null;
      if (!tabStillOpen && !sessionExists) return s;
      const run = runFor(s.tabSession[tabId] ?? emptyTabSession(), streamId);
      if (run == null) return s; // event from a superseded run
      const existing = run.results[resultIndex]?.result;
      const label = statement ?? undefined;
      let set_: ResultSet;
      if (error) {
        set_ = { result: null, error, statement: label };
      } else if (existing && existing.streamId === streamId) {
        // Streamed result set: merge backend metadata; rows stay as-is.
        set_ = {
          result: normalizeQueryResult({
            ...existing,
            rowCount: result?.rowCount ?? existing.rowCount,
            affectedRows: result?.affectedRows ?? existing.affectedRows,
            durationMs: result?.durationMs ?? existing.durationMs,
            message: result?.message ?? existing.message,
            primaryKeys: result?.primaryKeys ?? existing.primaryKeys,
            schemaName: result?.schemaName ?? existing.schemaName,
            tableName: result?.tableName ?? existing.tableName,
            streaming: false,
          }),
          error: null,
          statement: label,
        };
      } else {
        // Non-row statement (INSERT/DDL): no meta/rows streamed - use the backend payload directly.
        set_ = { result: normalizeQueryResult(result), error: null, statement: label };
      }
      const results = setResultAt(run.results, resultIndex, set_);
      const activeResultIndex = run.activeResultIndex < results.length ? run.activeResultIndex : 0;
      return {
        tabSession: {
          ...s.tabSession,
          [tabId]: withActiveMirror({ ...run, results, activeResultIndex }),
        },
        runningTabId: tabStillOpen ? tabId : s.runningTabId,
      };
    }),
  finishRun: (tabId, streamId, _resultCount, error, opts) =>
    set((s) => {
      const tabStillOpen = s.tabs.some((t) => t.id === tabId);
      const sessionExists = s.tabSession[tabId] != null;
      if (!tabStillOpen && !sessionExists) return s;
      const base = s.tabSession[tabId] ?? emptyTabSession();
      // A done from a superseded run must not clear a newer run's running indicator.
      if (base.runStreamId != null && streamIdLessThan(streamId, base.runStreamId)) return s;

      let session = base;
      if (error) {
        // Batch-level failure (e.g. a connection couldn't be acquired): show it as the lone result.
        const run = runFor(base, streamId) ?? base;
        session = withActiveMirror({ ...run, results: [{ result: null, error }], activeResultIndex: 0 });
      }
      let nextConnected = s.connectedIds;
      if (opts?.markConnected && opts.connectionId && !s.connectedIds[opts.connectionId]) {
        nextConnected = { ...s.connectedIds, [opts.connectionId]: true };
      }
      const nextRunning = s.runningTabId === tabId ? null : s.runningTabId;
      return {
        tabSession: { ...s.tabSession, [tabId]: session },
        connectedIds: nextConnected,
        runningTabId: nextRunning,
      };
    }),
  setActiveResultIndex: (tabId, index) =>
    set((s) => {
      const session = s.tabSession[tabId];
      if (!session || index < 0 || index >= session.results.length) return s;
      return {
        tabSession: { ...s.tabSession, [tabId]: withActiveMirror({ ...session, activeResultIndex: index }) },
      };
    }),
  getTabSession: (id) => get().tabSession[id] ?? emptyTabSession(),
  setRunningTab: (runningTabId) => set({ runningTabId }),
  setHistory: (history) => set({ history: Array.isArray(history) ? history : [] }),
  setSavedQueries: (savedQueries) => set({ savedQueries: Array.isArray(savedQueries) ? savedQueries : [] }),
  reorderTabs: (fromId, toId) => {
    if (fromId === toId) return;
    const tabs = [...get().tabs];
    const fromIdx = tabs.findIndex((t) => t.id === fromId);
    const toIdx = tabs.findIndex((t) => t.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = tabs.splice(fromIdx, 1);
    tabs.splice(toIdx, 0, moved);
    set({ tabs });
  },
  setSidebarView: (sidebarView) => set({ sidebarView }),
  setSelectedConnection: (selectedConnectionId) => set({ selectedConnectionId }),
}));
