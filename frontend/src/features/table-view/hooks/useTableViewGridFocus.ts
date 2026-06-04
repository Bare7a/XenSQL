import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { FocusCol } from '@/shared/lib/grid';
import {
  focusGridCellDom,
  resolveGridCellFocus,
  scrollVirtualizerToRow,
  type GridCellFocus,
} from '@/shared/lib/gridFocus';
import {
  applyScrollSnapshot,
  captureScrollSnapshot,
  restoreScrollSnapshot,
  type ScrollSnapshot,
} from '@/shared/lib/gridScroll';
import { findGridCellElement } from '@/shared/lib/gridCellRange';

interface UseTableViewGridFocusOptions {
  loading: boolean;
  editing: { row: number; col: number } | null;
  isActive: boolean;
  columnsLength: number;
  rowsLength: number;
  colCount: number;
  focusedRowIdx: number | null;
  focusedColPos: FocusCol;
  focusRef: React.RefObject<{ row: number | null; colPos: FocusCol }>;
  focusRow: (row: number, colPos?: FocusCol) => void;
  setFocusedRowIdx: (row: number | null) => void;
  setFocusedColPos: (colPos: FocusCol) => void;
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  colIndices: number[];
  getElementId: (type: 'cell' | 'rownum', rowIdx: number, colIdx: number) => string;
  rowHeight: number;
}

/**
 * Table-view focus persistence: highlight memory, refresh/tab restore, scroll snapshot, DOM focus.
 */
export function useTableViewGridFocus({
  loading,
  editing,
  isActive,
  columnsLength,
  rowsLength,
  colCount,
  focusedRowIdx,
  focusedColPos,
  focusRef,
  focusRow,
  setFocusedRowIdx,
  setFocusedColPos,
  tableWrapRef,
  rowVirtualizer,
  colIndices,
  getElementId,
  rowHeight,
}: UseTableViewGridFocusOptions): void {
  const wasActiveRef = useRef(false);
  const prevLoadingRef = useRef(loading);
  const restoreFocusRef = useRef<GridCellFocus | null>(null);
  const lastHighlightedRef = useRef<GridCellFocus | null>(null);
  const pendingDomFocusRef = useRef(false);
  const scrollSnapshotRef = useRef<ScrollSnapshot | null>(null);

  const currentFocusTarget = useCallback(
    () =>
      resolveGridCellFocus(
        focusRef.current.row,
        focusRef.current.colPos,
        rowsLength,
        colCount
      ),
    [focusRef, rowsLength, colCount]
  );

  const focusCell = useCallback(
    (row: number, colPos: FocusCol, scrollRow: boolean) => {
      const wrap = tableWrapRef.current;
      const colIdx = colIndices[colPos];
      focusGridCellDom({
        wrap,
        row,
        colPos,
        cellId: getElementId('cell', row, colIdx),
        scrollRow,
        rowHeight,
        scrollToRow: scrollRow
          ? () => scrollVirtualizerToRow(rowVirtualizer, row)
          : undefined,
        onFirstAttempt: scrollRow
          ? undefined
          : () => restoreScrollSnapshot(scrollSnapshotRef, wrap),
      });
    },
    [tableWrapRef, colIndices, getElementId, rowHeight, rowVirtualizer]
  );

  const syncFocusRow = useCallback(
    (target: GridCellFocus) => {
      if (focusedRowIdx !== target.row || focusedColPos !== target.colPos) {
        focusRow(target.row, target.colPos);
      }
    },
    [focusedRowIdx, focusedColPos, focusRow]
  );

  useEffect(() => {
    if (loading || editing != null || rowsLength === 0) return;
    const { row, colPos } = focusRef.current;
    if (row != null && colPos >= 0 && row < rowsLength && colPos < colCount) {
      lastHighlightedRef.current = { row, colPos };
    }
  }, [loading, editing, rowsLength, colCount, focusedRowIdx, focusedColPos, focusRef]);

  useEffect(() => {
    const loadingStarted = loading && !prevLoadingRef.current;
    const loadingEnded = !loading && prevLoadingRef.current;
    prevLoadingRef.current = loading;

    if (loadingStarted) {
      scrollSnapshotRef.current = captureScrollSnapshot(tableWrapRef.current);
      if (lastHighlightedRef.current) {
        restoreFocusRef.current = lastHighlightedRef.current;
      }
    }

    if (loading) return;

    if (columnsLength === 0) {
      setFocusedRowIdx(null);
      setFocusedColPos(0);
      restoreFocusRef.current = null;
      return;
    }

    if (rowsLength === 0) return;

    if (loadingEnded) {
      const saved = restoreFocusRef.current ?? lastHighlightedRef.current;
      restoreFocusRef.current = null;
      const target = saved
        ? resolveGridCellFocus(saved.row, saved.colPos, rowsLength, colCount)
        : null;
      if (target) {
        syncFocusRow(target);
        if (isActive) pendingDomFocusRef.current = true;
      }
      return;
    }

    if (focusedRowIdx != null && focusedRowIdx < rowsLength) {
      const colValid = focusedColPos < 0 || focusedColPos < colCount;
      if (colValid) return;
      focusRow(focusedRowIdx, 0);
      return;
    }

    if (lastHighlightedRef.current == null) {
      const initial = resolveGridCellFocus(null, 0, rowsLength, colCount);
      if (initial) focusRow(initial.row, initial.colPos);
    }
  }, [
    loading,
    isActive,
    columnsLength,
    rowsLength,
    colCount,
    focusedRowIdx,
    focusedColPos,
    focusRow,
    setFocusedRowIdx,
    setFocusedColPos,
    focusRef,
    tableWrapRef,
    syncFocusRow,
  ]);

  useLayoutEffect(() => {
    if (loading || rowsLength === 0) return;
    const snap = scrollSnapshotRef.current;
    if (!snap) return;
    const apply = () => applyScrollSnapshot(tableWrapRef.current, snap);
    apply();
    const id = requestAnimationFrame(() => {
      applyScrollSnapshot(tableWrapRef.current, snap);
      scrollSnapshotRef.current = null;
    });
    return () => cancelAnimationFrame(id);
  }, [loading, rowsLength, tableWrapRef]);

  useEffect(() => {
    if (!pendingDomFocusRef.current || !isActive || loading || editing != null) return;
    if (rowsLength === 0) return;
    const target = currentFocusTarget();
    if (!target) return;
    pendingDomFocusRef.current = false;
    focusCell(target.row, target.colPos, false);
  }, [
    isActive,
    loading,
    editing,
    rowsLength,
    colCount,
    focusedRowIdx,
    focusedColPos,
    focusCell,
    currentFocusTarget,
  ]);

  useEffect(() => {
    if (loading || editing != null || rowsLength === 0) return;
    const target = currentFocusTarget();
    if (!target) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    findGridCellElement(tableWrapRef.current, target.row, target.colPos)?.focus({
      preventScroll: true,
    });
  }, [rowsLength, loading, editing, currentFocusTarget, tableWrapRef]);

  useEffect(() => {
    const becameActive = isActive && !wasActiveRef.current;
    wasActiveRef.current = isActive;
    if (!becameActive || loading || editing != null || rowsLength === 0) return;
    const target = currentFocusTarget();
    if (!target) return;
    syncFocusRow(target);
    focusCell(target.row, target.colPos, true);
  }, [
    isActive,
    loading,
    editing,
    rowsLength,
    colCount,
    focusedRowIdx,
    focusedColPos,
    focusCell,
    currentFocusTarget,
    syncFocusRow,
  ]);
}
