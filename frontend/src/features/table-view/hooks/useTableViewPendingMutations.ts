import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PasteCellEdit } from '@/features/table-view/lib/tableViewClipboard';
import { appToast } from '@/shared/lib/appToast';
import { primaryKeyKey, rowPrimaryKey } from '@/shared/lib/grid';
import { useAppStore } from '@/store/appStore';
import type { TableViewPendingState, TableViewSessionState } from '@/types';
import { emptyTableViewPending } from '@/types';

// Cap each direction so a long editing session can't grow the snapshot stacks without bound.
const HISTORY_LIMIT = 100;

type PendingEdits = TableViewPendingState['edits'];

type ReconcileOutcome = 'changed' | 'unchanged' | 'ambiguous' | 'invalid';

/**
 * Reconcile one cell into the pending-edits draft: a value back at the original clears the recorded
 * edit, a value identical to the recorded edit is a no-op, anything else records it. Mutates `draft`
 * and reports whether it changed, so callers only commit (and record undo history) on real changes.
 */
export function reconcileCellEdit(
  draft: PendingEdits,
  pkKey: string,
  col: string,
  originalRaw: unknown,
  value: string | null,
): 'changed' | 'unchanged' {
  const original = originalRaw == null ? null : String(originalRaw);
  const next = value == null ? null : String(value);
  const rowEdits = { ...(draft[pkKey] ?? {}) };
  const hadCol = Reflect.has(rowEdits, col);
  const recorded = hadCol ? (rowEdits[col] == null ? null : String(rowEdits[col])) : undefined;

  if (next === original) {
    if (!hadCol) return 'unchanged'; // already at original - nothing to revert
    delete rowEdits[col];
  } else {
    if (hadCol && recorded === next) return 'unchanged'; // identical edit already recorded
    rowEdits[col] = value;
  }
  if (Object.keys(rowEdits).length === 0) delete draft[pkKey];
  else draft[pkKey] = rowEdits;
  return 'changed';
}

interface UseTableViewPendingMutationsArgs {
  tabId: string;
  readOnly: boolean;
  state: TableViewSessionState;
  persistState: (patch: Partial<TableViewSessionState>) => void;
}

/**
 * Pending-change mutations for a table-view tab: cell edits, paste batches, and row delete toggles,
 * each recorded as one undoable snapshot on shared undo/redo stacks.
 */
export function useTableViewPendingMutations({
  tabId,
  readOnly,
  state,
  persistState,
}: UseTableViewPendingMutationsArgs) {
  const { t } = useTranslation();

  // Undo/redo stacks of whole pending snapshots. They live in refs (no re-render needed) and, because
  // the pane stays mounted per tab, survive tab switches - matching pending's in-memory lifetime.
  const undoStackRef = useRef<TableViewPendingState[]>([]);
  const redoStackRef = useRef<TableViewPendingState[]>([]);

  const readPending = useCallback(
    (): TableViewPendingState =>
      useAppStore.getState().tabSession[tabId]?.tableViewState?.pending ?? emptyTableViewPending(),
    [tabId],
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

  // Deleted rows' pending edits are discarded on apply - exclude them from editCount.
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

  // Resolve the row/column/pk context, then defer to the pure reconcile above.
  const reconcileCellEditAt = useCallback(
    (draft: PendingEdits, rowIdx: number, col: string, value: string | null): ReconcileOutcome => {
      const row = state.rows[rowIdx];
      if (!row) return 'invalid';
      const colIdx = state.columns.indexOf(col);
      if (colIdx < 0) return 'invalid';
      const pkKey = primaryKeyKey(rowPrimaryKey(row, state.columns, state.primaryKeys));
      if (ambiguousKeys.has(pkKey)) return 'ambiguous';
      return reconcileCellEdit(draft, pkKey, col, row[colIdx], value);
    },
    [state.rows, state.columns, state.primaryKeys, ambiguousKeys],
  );

  const handleCellEdit = useCallback(
    (rowIdx: number, col: string, value: string | null) => {
      if (readOnly || !state.primaryKeys.length) return;
      const edits = { ...state.pending.edits };
      const outcome = reconcileCellEditAt(edits, rowIdx, col, value);
      if (outcome === 'ambiguous') {
        appToast.error(t('tableView.ambiguousRow'));
        return;
      }
      if (outcome !== 'changed') return;
      commitPending(state.pending, { ...state.pending, edits });
    },
    [readOnly, state.primaryKeys, state.pending, reconcileCellEditAt, commitPending, t],
  );

  // Apply a batch of pasted cells as one undoable step: reconcile per cell, commit the combined result once.
  const handlePasteCells = useCallback(
    (cellEdits: PasteCellEdit[]) => {
      if (readOnly || !state.primaryKeys.length || cellEdits.length === 0) return;
      const edits = { ...state.pending.edits };
      let changed = false;
      let blockedAmbiguous = false;

      for (const { rowIdx, col, value } of cellEdits) {
        const outcome = reconcileCellEditAt(edits, rowIdx, col, value);
        if (outcome === 'ambiguous') blockedAmbiguous = true;
        else if (outcome === 'changed') changed = true;
      }

      if (blockedAmbiguous) appToast.error(t('tableView.ambiguousRow'));
      if (!changed) return;
      commitPending(state.pending, { ...state.pending, edits });
    },
    [readOnly, state.primaryKeys, state.pending, reconcileCellEditAt, commitPending, t],
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

  return {
    undo,
    redo,
    clearPending,
    handleCellEdit,
    handlePasteCells,
    handleToggleDeleteRow,
    editCount,
    deleteCount,
    hasPending,
  };
}
