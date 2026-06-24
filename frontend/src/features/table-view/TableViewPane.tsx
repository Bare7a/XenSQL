import { Filter, Minus, Plus, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SqlConditionInput } from '@/features/editor/SqlConditionInput';
import type { PasteCellEdit } from '@/features/table-view/lib/tableViewClipboard';
import { mergeTablePage, primaryKeyKey, rowPrimaryKey, TABLE_PAGE_SIZE } from '@/features/table-view/lib/tableViewRows';
import { TableViewAddRowDialog } from '@/features/table-view/TableViewAddRowDialog';
import { type TableSortDir, TableViewGrid } from '@/features/table-view/TableViewGrid';
import { ErrorState } from '@/shared/components/ErrorState';
import { api } from '@/shared/lib/api';
import { appError } from '@/shared/lib/appDialog';
import { appToast } from '@/shared/lib/appToast';
import { useAppStore } from '@/store/appStore';
import type { DriverType, EditorTab, TableViewPendingState, TableViewSessionState } from '@/types';
import { emptyTableViewPending } from '@/types';

const sameStrings = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// Cap each direction so a long editing session can't grow the snapshot stacks without bound.
const HISTORY_LIMIT = 100;

interface Props {
  tab: EditorTab;
  driver: DriverType;
  readOnly: boolean;
  isActive: boolean;
  running: boolean;
  onFocusedRowChange: (row: Record<string, unknown> | null) => void;
}

function emptyTableViewState(schema: string, table: string): TableViewSessionState {
  return {
    schema,
    table,
    filter: '',
    orderBy: null,
    orderDir: 'ASC',
    rows: [],
    columns: [],
    columnTypes: [],
    primaryKeys: [],
    hasMore: false,
    pending: emptyTableViewPending(),
  };
}

export function TableViewPane({ tab, driver, readOnly, isActive, running, onFocusedRowChange }: Props) {
  const { t } = useTranslation();
  // biome-ignore lint/style/noNonNullAssertion: TableViewPane is only rendered for table-view tabs, so tab.tableView is guaranteed present.
  const tv = tab.tableView!;
  const session = useAppStore((s) => s.tabSession[tab.id]?.tableViewState);
  const result = useAppStore((s) => s.tabSession[tab.id]?.result);
  const resultError = useAppStore((s) => s.tabSession[tab.id]?.resultError);
  const updateTabSession = useAppStore((s) => s.updateTabSession);
  const setRunningTab = useAppStore((s) => s.setRunningTab);

  const [filterDraft, setFilterDraft] = useState(session?.filter ?? '');
  const loadMetaRef = useRef<{ offset: number; replace: boolean }>({ offset: 0, replace: true });
  const lastMergedStreamIdRef = useRef<string | null>(null);
  const seenStreamStartRef = useRef<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [addRowOpen, setAddRowOpen] = useState(false);
  const [focusedRowIdx, setFocusedRowIdx] = useState<number | null>(null);

  const onFocusedRowChangeRef = useRef(onFocusedRowChange);
  onFocusedRowChangeRef.current = onFocusedRowChange;
  const notifyFocusedRow = useCallback((row: Record<string, unknown> | null) => onFocusedRowChangeRef.current(row), []);

  const state = session ?? emptyTableViewState(tv.schema, tv.table);

  const persistState = useCallback(
    (patch: Partial<TableViewSessionState>) => {
      const prev = useAppStore.getState().tabSession[tab.id]?.tableViewState;
      const base = prev ?? emptyTableViewState(tv.schema, tv.table);
      updateTabSession(tab.id, {
        tableViewState: { ...base, ...patch },
        dataBrowser: { schema: tv.schema, table: tv.table },
      });
    },
    [tab.id, tv.schema, tv.table, updateTabSession],
  );

  // Undo/redo stacks of whole pending snapshots. They live in refs (no re-render needed) and, because
  // the pane stays mounted per tab, survive tab switches - matching pending's in-memory lifetime.
  const undoStackRef = useRef<TableViewPendingState[]>([]);
  const redoStackRef = useRef<TableViewPendingState[]>([]);

  const readPending = useCallback(
    (): TableViewPendingState =>
      useAppStore.getState().tabSession[tab.id]?.tableViewState?.pending ?? emptyTableViewPending(),
    [tab.id],
  );

  const clearPending = useCallback(() => {
    // Applying, resetting, or reloading the dataset makes prior snapshots reference rows that may no
    // longer exist - drop the history alongside the pending changes.
    undoStackRef.current = [];
    redoStackRef.current = [];
    persistState({ pending: emptyTableViewPending() });
  }, [persistState]);

  // Every history-recording mutation funnels through here: push the prior state, drop the redo
  // branch, then commit. Paste records a single entry by computing the whole next state up front.
  const commitPending = useCallback(
    (prev: TableViewPendingState, next: TableViewPendingState) => {
      undoStackRef.current.push(prev);
      if (undoStackRef.current.length > HISTORY_LIMIT) undoStackRef.current.shift();
      redoStackRef.current = [];
      persistState({ pending: next });
    },
    [persistState],
  );

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (prev === undefined) return;
    redoStackRef.current.push(readPending());
    persistState({ pending: prev });
  }, [readPending, persistState]);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (next === undefined) return;
    undoStackRef.current.push(readPending());
    persistState({ pending: next });
  }, [readPending, persistState]);

  // Deleted rows' pending edits are discarded in handleApply - exclude them from editCount.
  const deleteCount = state.pending.deletes.length;
  const deleteSet = new Set(state.pending.deletes);
  const editCount = Object.keys(state.pending.edits).filter((key) => !deleteSet.has(key)).length;
  const hasPending = editCount > 0 || deleteCount > 0;

  // PK values mapping to more than one loaded row (view / non-unique PK); editing by such a key would
  // hit every match, so it's blocked.
  const ambiguousKeys = useMemo(() => {
    if (!state.primaryKeys.length) return new Set<string>();
    const counts = new Map<string, number>();
    for (const row of state.rows) {
      const key = primaryKeyKey(rowPrimaryKey(row, state.columns, state.primaryKeys));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const dups = new Set<string>();
    for (const [key, n] of counts) if (n > 1) dups.add(key);
    return dups;
  }, [state.rows, state.columns, state.primaryKeys]);

  const fetchPage = useCallback(
    async (opts: {
      offset: number;
      replace: boolean;
      filter?: string;
      orderBy?: string | null;
      orderDir?: TableSortDir;
      discardPending?: boolean;
    }) => {
      const filter = opts.filter ?? state.filter;
      const orderBy = opts.orderBy !== undefined ? opts.orderBy : state.orderBy;
      const orderDir = opts.orderDir ?? state.orderDir;

      if (opts.discardPending) clearPending();

      const statePatch: Partial<TableViewSessionState> = {};
      if (opts.filter !== undefined) statePatch.filter = opts.filter;
      if (opts.orderBy !== undefined) statePatch.orderBy = opts.orderBy;
      if (opts.orderDir !== undefined) statePatch.orderDir = opts.orderDir;
      if (Object.keys(statePatch).length > 0) persistState(statePatch);

      loadMetaRef.current = { offset: opts.offset, replace: opts.replace };
      setRunningTab(tab.id);
      updateTabSession(tab.id, { resultError: null });

      try {
        await api.queryTableStream(tab.connectionId, tab.id, {
          schema: tv.schema,
          table: tv.table,
          offset: opts.offset,
          limit: TABLE_PAGE_SIZE,
          filter: filter.trim() || undefined,
          orderBy: orderBy ?? undefined,
          orderDir: orderBy ? orderDir : undefined,
        });
      } catch (e) {
        updateTabSession(tab.id, { resultError: String(e) });
        setRunningTab(null);
      }
    },
    [
      tab.id,
      tab.connectionId,
      tv.schema,
      tv.table,
      state.filter,
      state.orderBy,
      state.orderDir,
      clearPending,
      setRunningTab,
      updateTabSession,
    ],
  );

  useEffect(() => {
    if (!isActive) return;
    const existing = useAppStore.getState().tabSession[tab.id]?.tableViewState;
    if (existing?.columns.length) return;
    // Honor a restored filter (e.g. after an app restart) on the first load instead of resetting it.
    void fetchPage({
      offset: 0,
      replace: true,
      filter: existing?.filter ?? '',
      orderBy: existing?.orderBy ?? null,
      orderDir: existing?.orderDir ?? 'ASC',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, isActive]);

  // Merge only after stream completes - partial-batch dedup breaks replace pages and load-more would double-count.
  // On a replace load, clear rows the first time a new streamId appears so the grid empties while the query runs.
  useEffect(() => {
    if (!result) return;
    const streamId = result.streamId ?? null;

    if (result.streaming) {
      if (loadMetaRef.current.replace && streamId != null && seenStreamStartRef.current !== streamId) {
        seenStreamStartRef.current = streamId;
        const store = useAppStore.getState();
        const current = store.tabSession[tab.id]?.tableViewState;
        if (current && current.rows.length > 0) {
          updateTabSession(tab.id, {
            tableViewState: { ...current, rows: [], hasMore: false },
          });
        }
      }
      return;
    }

    if (lastMergedStreamIdRef.current === streamId && streamId != null) return;
    lastMergedStreamIdRef.current = streamId;
    seenStreamStartRef.current = streamId;

    const store = useAppStore.getState();
    if (!store.tabs.some((t) => t.id === tab.id && t.tableView)) return;
    const current = store.tabSession[tab.id]?.tableViewState;
    if (!current) return;
    const { replace } = loadMetaRef.current;
    const merged = mergeTablePage(current.rows, result.rows, replace);
    // Stable column/type/PK refs when unchanged, so the grid doesn't re-derive its layout (which drops the focused cell).
    const resultPks = result.primaryKeys ?? [];
    updateTabSession(tab.id, {
      tableViewState: {
        ...current,
        rows: merged,
        columns: sameStrings(current.columns, result.columns) ? current.columns : result.columns,
        columnTypes: sameStrings(current.columnTypes, result.columnTypes) ? current.columnTypes : result.columnTypes,
        primaryKeys: sameStrings(current.primaryKeys, resultPks) ? current.primaryKeys : resultPks,
        hasMore: result.rows.length >= TABLE_PAGE_SIZE,
      },
      dataBrowser: { schema: tv.schema, table: tv.table },
    });
    setRunningTab(null);
  }, [result, tab.id, tv.schema, tv.table, updateTabSession, setRunningTab]);

  const applyFilter = () => {
    persistState({ filter: filterDraft });
    void fetchPage({
      offset: 0,
      replace: true,
      filter: filterDraft,
      discardPending: true,
    });
  };

  // Wrapped in useCallback so memo(TableViewGrid) holds across parent-only re-renders.
  const handleSortChange = useCallback(
    (col: string) => {
      const nextDir: TableSortDir = state.orderBy === col && state.orderDir === 'ASC' ? 'DESC' : 'ASC';
      void fetchPage({
        offset: 0,
        replace: true,
        orderBy: col,
        orderDir: nextDir,
        discardPending: true,
      });
    },
    [state.orderBy, state.orderDir, fetchPage],
  );

  const handleLoadMore = useCallback(() => {
    if (running || !state.hasMore || hasPending) return;
    void fetchPage({ offset: state.rows.length, replace: false });
  }, [running, state.hasMore, hasPending, state.rows.length, fetchPage]);

  const handleCellEdit = useCallback(
    (rowIdx: number, col: string, value: string | null) => {
      if (readOnly || !state.primaryKeys.length) return;

      const colIdx = state.columns.indexOf(col);
      const origRaw = colIdx >= 0 ? state.rows[rowIdx]?.[colIdx] : undefined;
      const orig = origRaw == null ? null : String(origRaw);
      const next = value == null ? null : String(value);

      const pk = rowPrimaryKey(state.rows[rowIdx], state.columns, state.primaryKeys);
      const key = primaryKeyKey(pk);
      if (ambiguousKeys.has(key)) {
        appToast.error(t('tableView.ambiguousRow'));
        return;
      }
      const edits = { ...state.pending.edits };
      const rowEdits = { ...(edits[key] ?? {}) };

      if (next === orig) delete rowEdits[col];
      else rowEdits[col] = value;

      if (Object.keys(rowEdits).length === 0) delete edits[key];
      else edits[key] = rowEdits;

      commitPending(state.pending, { ...state.pending, edits });
    },
    [readOnly, state.primaryKeys, state.columns, state.rows, state.pending, ambiguousKeys, commitPending, t],
  );

  // Apply a batch of pasted cells as one undoable step. Mirrors handleCellEdit's reconcile (revert
  // detection, ambiguous-key blocking) per cell, then commits the combined result once.
  const handlePasteCells = useCallback(
    (cellEdits: PasteCellEdit[]) => {
      if (readOnly || !state.primaryKeys.length || cellEdits.length === 0) return;
      const edits = { ...state.pending.edits };
      let changed = false;
      let blockedAmbiguous = false;

      for (const { rowIdx, col, value } of cellEdits) {
        const row = state.rows[rowIdx];
        if (!row) continue;
        const colIdx = state.columns.indexOf(col);
        if (colIdx < 0) continue;
        const key = primaryKeyKey(rowPrimaryKey(row, state.columns, state.primaryKeys));
        if (ambiguousKeys.has(key)) {
          blockedAmbiguous = true;
          continue;
        }
        const origRaw = row[colIdx];
        const orig = origRaw == null ? null : String(origRaw);
        const next = value == null ? null : String(value);
        const rowEdits = { ...(edits[key] ?? {}) };
        const hadCol = Reflect.has(rowEdits, col);
        const prevVal = hadCol ? (rowEdits[col] == null ? null : String(rowEdits[col])) : undefined;

        if (next === orig) {
          if (!hadCol) continue; // already at original - nothing to revert
          delete rowEdits[col];
        } else {
          if (hadCol && prevVal === next) continue; // identical edit already recorded
          rowEdits[col] = value;
        }
        if (Object.keys(rowEdits).length === 0) delete edits[key];
        else edits[key] = rowEdits;
        changed = true;
      }

      if (blockedAmbiguous) appToast.error(t('tableView.ambiguousRow'));
      if (!changed) return;
      commitPending(state.pending, { ...state.pending, edits });
    },
    [readOnly, state.primaryKeys, state.columns, state.rows, state.pending, ambiguousKeys, commitPending, t],
  );

  const handleToggleDeleteRow = useCallback(
    (rowIdx: number) => {
      if (readOnly || !state.primaryKeys.length) return;
      const pk = rowPrimaryKey(state.rows[rowIdx], state.columns, state.primaryKeys);
      const key = primaryKeyKey(pk);
      if (ambiguousKeys.has(key)) {
        appToast.error(t('tableView.ambiguousRow'));
        return;
      }
      const deletes = new Set(state.pending.deletes);
      if (deletes.has(key)) deletes.delete(key);
      else deletes.add(key);
      commitPending(state.pending, { ...state.pending, deletes: [...deletes] });
    },
    [readOnly, state.primaryKeys, state.columns, state.rows, state.pending, ambiguousKeys, commitPending, t],
  );

  const handleRefresh = useCallback(() => {
    if (running || applying) return;
    void fetchPage({ offset: 0, replace: true, filter: state.filter });
  }, [running, applying, fetchPage, state.filter]);

  const handleReset = () => {
    clearPending();
    void fetchPage({ offset: 0, replace: true, discardPending: false });
  };

  const handleApply = useCallback(async () => {
    if (readOnly || !hasPending) return;
    setApplying(true);
    try {
      if (state.pending.deletes.length) {
        const primaryKeys = state.pending.deletes.map((key) => JSON.parse(key) as Record<string, unknown>);
        await api.deleteRows(tab.connectionId, {
          schema: tv.schema,
          table: tv.table,
          primaryKeys,
        });
      }
      for (const [key, changes] of Object.entries(state.pending.edits)) {
        if (state.pending.deletes.includes(key)) continue;
        const pk = JSON.parse(key) as Record<string, unknown>;
        await api.updateRow(tab.connectionId, {
          schema: tv.schema,
          table: tv.table,
          primaryKey: pk,
          changes,
        });
      }
      clearPending();
    } catch (e) {
      void appError(e, t('errors.generic'));
    } finally {
      // Always resync with the DB: on a partial failure this drops the (now-applied) deletes/edits
      // from view and reflects what actually changed. Re-applying is idempotent, so kept pending
      // entries can be safely retried.
      setFilterDraft(state.filter);
      await fetchPage({ offset: 0, replace: true, filter: state.filter });
      setApplying(false);
    }
  }, [
    readOnly,
    hasPending,
    state.pending,
    state.filter,
    tab.connectionId,
    tv.schema,
    tv.table,
    clearPending,
    fetchPage,
    t,
  ]);

  const tableName = useMemo(() => `${tv.schema}.${tv.table}`, [tv.schema, tv.table]);

  const handleInsertRow = async (values: Record<string, unknown>) => {
    await api.insertRow(tab.connectionId, tv.schema, tv.table, values);
    clearPending();
    await fetchPage({ offset: 0, replace: true, filter: state.filter });
    setAddRowOpen(false);
  };

  const handleDeleteFocused = () => {
    if (focusedRowIdx != null && focusedRowIdx >= 0) {
      handleToggleDeleteRow(focusedRowIdx);
    }
  };

  return (
    <div className="table-view-pane">
      <div className="table-view-filter-bar">
        <Filter className="icon-sm table-view-filter-icon" aria-hidden />
        <SqlConditionInput
          value={filterDraft}
          onChange={setFilterDraft}
          onSubmit={applyFilter}
          columns={state.columns}
          columnTypes={state.columnTypes}
          driver={driver}
          placeholder={t('tableView.filterPlaceholder')}
          ariaLabel={t('tableView.filterPlaceholder')}
        />
        <button
          type="button"
          className="btn btn-sm sql-condition-input-icon"
          onClick={applyFilter}
          disabled={running}
          aria-label={t('tableView.applyFilter')}
        >
          <Search className="icon-sm" />
        </button>
      </div>

      <div className="table-view-grid-wrap">
        {resultError ? (
          <ErrorState message={resultError} />
        ) : (
          <TableViewGrid
            columns={state.columns}
            columnTypes={state.columnTypes}
            rows={state.rows}
            primaryKeys={state.primaryKeys}
            pending={state.pending}
            tableName={tableName}
            readOnly={readOnly}
            orderBy={state.orderBy}
            orderDir={state.orderDir}
            loading={running || applying}
            hasMore={state.hasMore && !hasPending}
            isActive={isActive}
            onSortChange={handleSortChange}
            onCellEdit={handleCellEdit}
            onPasteCells={handlePasteCells}
            onUndo={undo}
            onRedo={redo}
            onToggleDeleteRow={handleToggleDeleteRow}
            onFocusedRowChange={notifyFocusedRow}
            onFocusedRowIndexChange={setFocusedRowIdx}
            onLoadMore={handleLoadMore}
            onApply={handleApply}
            onRefresh={handleRefresh}
          />
        )}
      </div>

      <div className="table-view-footer">
        <div className="table-view-footer-left">
          <button
            type="button"
            className="btn btn-sm"
            onClick={handleReset}
            disabled={!hasPending || running || applying}
          >
            {t('tableView.reset')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary table-view-apply-btn"
            onClick={() => void handleApply()}
            disabled={!hasPending || readOnly || running || applying}
          >
            {t('tableView.apply')}
          </button>
          {hasPending && (
            <span className="table-view-pending-summary">
              {editCount > 0 && (
                <span className="table-view-pending-stat table-view-pending-stat--update">
                  {t('tableView.pendingUpdates', { count: editCount })}
                </span>
              )}
              {deleteCount > 0 && (
                <span className="table-view-pending-stat table-view-pending-stat--delete">
                  {t('tableView.pendingDeletes', { count: deleteCount })}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="table-view-footer-right">
          <button
            type="button"
            className="btn btn-sm btn-icon"
            onClick={handleRefresh}
            disabled={running || applying}
            data-tooltip={t('tableView.refresh')}
          >
            <RefreshCw className="icon-sm" />
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={() => setAddRowOpen(true)}
                disabled={running || applying || !state.columns.length}
                data-tooltip={t('tableView.addRow')}
              >
                <Plus className="icon-sm" />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={handleDeleteFocused}
                disabled={running || applying || !state.primaryKeys.length}
                data-tooltip={t('tableView.deleteRow')}
              >
                <Minus className="icon-sm" />
              </button>
            </>
          )}
        </div>
      </div>

      {addRowOpen && !readOnly && (
        <TableViewAddRowDialog
          connectionId={tab.connectionId}
          driver={driver}
          schema={tv.schema}
          table={tv.table}
          onClose={() => setAddRowOpen(false)}
          onConfirm={handleInsertRow}
        />
      )}
    </div>
  );
}
