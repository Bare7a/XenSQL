import { useCallback, useRef, useState } from 'react';
import { useColumnResize } from '@/shared/hooks/useColumnResize';
import { useGridGlobalKeys } from '@/shared/hooks/useGridGlobalKeys';
import { queryElementInContainer } from '@/shared/lib/dom';
import { columnRangeSet, type FocusCol, rowRangeSet } from '@/shared/lib/grid';
import {
  type CellCoord,
  type CellRange,
  findDataCellAtPoint,
  fullColsCellRange,
  fullRowsCellRange,
  normalizeCellRange,
} from '@/shared/lib/gridCellRange';
import { adjustGridCellScrollInWrap } from '@/shared/lib/gridScroll';

export interface RowIndexMap {
  globalAt(displayIdx: number): number | null | undefined;
  /** Returns -1 if not visible. */
  sortedOf(globalIdx: number): number;
  sortedIndices: number[] | null;
}

interface UseGridCoreOptions {
  rowCount: number;
  colIndices: number[];
  displayColumns: string[];
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
  applyColumnWidth(colPos: number, width: number): void;
  scrollToRow(displayIdx: number): void;
  getElementId(type: 'cell' | 'rownum', rowIdx: number, colIdx: number): string;
  rowIndex?: RowIndexMap | null;
  onFocusedRowChange?(globalIdx: number | null): void;
}

export function useGridCore({
  rowCount,
  colIndices,
  displayColumns,
  tableWrapRef,
  applyColumnWidth,
  scrollToRow,
  getElementId,
  rowIndex = null,
  onFocusedRowChange,
}: UseGridCoreOptions) {
  const [cellRange, setCellRange] = useState<CellRange | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [focusedRowIdx, setFocusedRowIdx] = useState<number | null>(null);
  const [focusedColPos, setFocusedColPos] = useState<FocusCol>(0);
  const [isSelecting, setIsSelecting] = useState(false);

  const rowAnchorRef = useRef<number | null>(null);
  const columnAnchorRef = useRef<string | null>(null);
  const selectingRef = useRef(false);
  const selectionAnchorRef = useRef<CellCoord | null>(null);
  const shiftMouseDownAppliedRef = useRef(false);
  const selectionRef = useRef<{ rows: Set<number>; cols: Set<string> }>({
    rows: selectedRows,
    cols: selectedColumns,
  });
  const focusRef = useRef<{ row: number | null; colPos: FocusCol }>({
    row: focusedRowIdx,
    colPos: focusedColPos,
  });
  const onFocusedRowChangeRef = useRef(onFocusedRowChange);

  selectionRef.current = { rows: selectedRows, cols: selectedColumns };
  focusRef.current = { row: focusedRowIdx, colPos: focusedColPos };
  onFocusedRowChangeRef.current = onFocusedRowChange;

  const globalAt = rowIndex?.globalAt ?? ((i: number): number => i);
  const sortedOf = rowIndex?.sortedOf ?? ((i: number): number => i);
  const sortedIndices = rowIndex?.sortedIndices ?? null;

  const clearSelection = useCallback(() => {
    setCellRange(null);
    selectionAnchorRef.current = null;
    setSelectedRows(new Set());
    setSelectedColumns(new Set());
    rowAnchorRef.current = null;
    columnAnchorRef.current = null;
  }, []);

  const focusRow = useCallback((globalIdx: number, colPos: FocusCol = 0) => {
    setFocusedRowIdx(globalIdx);
    setFocusedColPos(colPos);
    onFocusedRowChangeRef.current?.(globalIdx);
  }, []);

  const focusElement = useCallback(
    (globalIdx: number, colPos: FocusCol) => {
      const displayIdx = sortedOf(globalIdx);
      if (displayIdx >= 0) scrollToRow(displayIdx);
      const colIdx = colPos >= 0 ? colIndices[colPos] : -1;
      const id = getElementId(colPos < 0 ? 'rownum' : 'cell', globalIdx, colIdx);

      const scrollIntoView = () => {
        const wrap = tableWrapRef.current;
        const el = queryElementInContainer(wrap, id);
        if (!el || !wrap) return;
        if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
        adjustGridCellScrollInWrap(wrap, el);
      };

      requestAnimationFrame(() => {
        if (queryElementInContainer(tableWrapRef.current, id)) scrollIntoView();
        else requestAnimationFrame(scrollIntoView);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colIndices, getElementId, scrollToRow, tableWrapRef],
  );

  const applyRowModeCellRange = useCallback((range: CellRange, rowsToSelect: Set<number>) => {
    setCellRange(range);
    selectionAnchorRef.current = null;
    setSelectedRows(rowsToSelect);
    setSelectedColumns(new Set());
  }, []);

  const applyColModeCellRange = useCallback((range: CellRange, colsToSelect: Set<string>) => {
    setCellRange(range);
    selectionAnchorRef.current = null;
    setSelectedColumns(colsToSelect);
    setSelectedRows(new Set());
  }, []);

  const { resizingRef, startColResize } = useColumnResize(applyColumnWidth);

  // Also mirrors into selectionRef so Ctrl+C sees the latest selection before React flushes state.
  const applyCellRangeSelection = useCallback(
    (anchor: CellCoord, cur: CellCoord) => {
      const range = normalizeCellRange(anchor, cur);
      setCellRange(range);
      const nextCols = new Set<string>();
      for (let c = range.c0; c <= range.c1; c++) {
        const name = displayColumns[c];
        if (name) nextCols.add(name);
      }
      const nextRows = new Set<number>();
      for (let r = range.r0; r <= range.r1; r++) {
        const gi = globalAt(r);
        if (gi != null) nextRows.add(gi as number);
      }
      selectionRef.current = { rows: nextRows, cols: nextCols };
      setSelectedColumns(nextCols);
      setSelectedRows(nextRows);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayColumns],
  );

  const selectAllCells = useCallback(() => {
    if (rowCount === 0 || colIndices.length === 0) return;
    const anchor: CellCoord = { row: 0, col: 0 };
    const end: CellCoord = { row: rowCount - 1, col: colIndices.length - 1 };
    selectionAnchorRef.current = anchor;
    applyCellRangeSelection(anchor, end);
  }, [rowCount, colIndices.length, applyCellRangeSelection]);

  const { shiftHeldRef } = useGridGlobalKeys({ tableWrapRef, selectAllCells });

  // Prefer selectionAnchorRef over focusRef: on Windows/WebView2 a shift+click re-fires (mousedown→click→mousedown→click) and focusRef is stale; anchorRef also gives Excel-style extension from the original non-shift click.
  const resolveShiftAnchor = (fallback: CellCoord): CellCoord => {
    const existingAnchor = selectionAnchorRef.current;
    const fr = focusRef.current.row;
    const fc = focusRef.current.colPos;
    const fDisplay = fr != null && fc >= 0 ? sortedOf(fr) : -1;
    return existingAnchor ?? (fDisplay >= 0 && fc >= 0 ? { row: fDisplay, col: fc } : fallback);
  };

  const handleCellMouseDown = (displayIdx: number, colPos: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const shift = e.shiftKey || shiftHeldRef.current || e.nativeEvent.getModifierState?.('Shift');

    if (shift) {
      const anchor = resolveShiftAnchor({ row: displayIdx, col: colPos });
      const gi = globalAt(displayIdx);
      if (gi != null) {
        focusRow(gi as number, colPos);
        focusElement(gi as number, colPos);
      }
      selectionAnchorRef.current = anchor;
      applyCellRangeSelection(anchor, { row: displayIdx, col: colPos });
      shiftMouseDownAppliedRef.current = true;
      return;
    }

    const gi = globalAt(displayIdx);
    if (gi != null) focusRow(gi as number, colPos);
    // preventScroll: an accidental viewport jump would break drag hit-testing.
    const colIdx = colIndices[colPos];
    queryElementInContainer(tableWrapRef.current, getElementId('cell', (gi ?? displayIdx) as number, colIdx))?.focus({
      preventScroll: true,
    });

    selectingRef.current = true;
    setIsSelecting(true);
    const anchor: CellCoord = { row: displayIdx, col: colPos };
    selectionAnchorRef.current = anchor;
    applyCellRangeSelection(anchor, anchor);

    const onMove = (ev: MouseEvent) => {
      const hit = findDataCellAtPoint(tableWrapRef.current, ev.clientX, ev.clientY);
      if (hit) applyCellRangeSelection(anchor, hit);
    };
    const onUp = () => {
      selectingRef.current = false;
      setIsSelecting(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleColumnHeaderClick = (col: string, colPos: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (resizingRef.current) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const fr = focusRef.current.row;
    if (fr != null) setFocusedColPos(colPos);
    const singleSelectedCol = selectedColumns.size === 1 ? Array.from(selectedColumns)[0] : null;
    const anchor = singleSelectedCol ?? columnAnchorRef.current ?? col;

    if (shift) {
      const next = columnRangeSet(displayColumns, anchor, col, ctrl, selectedColumns);
      let minC = Infinity;
      let maxC = -Infinity;
      for (const name of next) {
        const p = displayColumns.indexOf(name);
        if (p >= 0) {
          minC = Math.min(minC, p);
          maxC = Math.max(maxC, p);
        }
      }
      if (minC !== Infinity) {
        applyColModeCellRange(fullColsCellRange(minC, maxC, rowCount), next);
      } else {
        setCellRange(null);
        setSelectedColumns(next);
        setSelectedRows(new Set());
      }
      columnAnchorRef.current = col;
      return;
    }

    if (ctrl) {
      setCellRange(null);
      selectionAnchorRef.current = null;
      const next = new Set(selectedColumns);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      setSelectedColumns(next);
      setSelectedRows(new Set());
      columnAnchorRef.current = col;
      return;
    }

    applyColModeCellRange(fullColsCellRange(colPos, colPos, rowCount), new Set([col]));
    columnAnchorRef.current = col;
  };

  const handleRowGutterClick = (globalIdx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const displayIdx = sortedOf(globalIdx);
    const fr = focusRef.current.row;
    const anchor = rowAnchorRef.current ?? (fr != null && sortedOf(fr) >= 0 ? fr : globalIdx);

    if (shift) {
      const next = rowRangeSet(sortedIndices, rowCount, anchor, globalIdx, ctrl, selectedRows);
      let minS = Infinity;
      let maxS = -Infinity;
      for (const gi of next) {
        const si = sortedOf(gi);
        if (si >= 0) {
          minS = Math.min(minS, si);
          maxS = Math.max(maxS, si);
        }
      }
      if (minS !== Infinity) {
        applyRowModeCellRange(fullRowsCellRange(minS, maxS, colIndices.length), next);
      } else {
        setCellRange(null);
        setSelectedRows(next);
        setSelectedColumns(new Set());
      }
      rowAnchorRef.current = globalIdx;
      focusRow(globalIdx, -1);
      return;
    }

    if (ctrl) {
      setCellRange(null);
      selectionAnchorRef.current = null;
      const next = new Set(selectedRows);
      if (next.has(globalIdx)) next.delete(globalIdx);
      else next.add(globalIdx);
      setSelectedRows(next);
      setSelectedColumns(new Set());
      rowAnchorRef.current = globalIdx;
      focusRow(globalIdx, -1);
      return;
    }

    if (displayIdx >= 0) {
      applyRowModeCellRange(fullRowsCellRange(displayIdx, displayIdx, colIndices.length), new Set([globalIdx]));
    }
    rowAnchorRef.current = globalIdx;
    focusRow(globalIdx, -1);
  };

  const handleCellClick = (displayIdx: number, globalIdx: number, colPos: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (shiftMouseDownAppliedRef.current) {
      shiftMouseDownAppliedRef.current = false;
      return;
    }
    const shift = e.shiftKey || shiftHeldRef.current || e.nativeEvent.getModifierState?.('Shift');
    if (shift) {
      // WebView2 re-fire guard: reuse the stored anchor so we re-apply A→B instead of collapsing to B→B.
      const anchor = resolveShiftAnchor({ row: displayIdx, col: colPos });
      selectionAnchorRef.current = anchor;
      applyCellRangeSelection(anchor, { row: displayIdx, col: colPos });
      focusRow(globalIdx, colPos);
      focusElement(globalIdx, colPos);
      return;
    }
    const { rows: selRows, cols: selCols } = selectionRef.current;
    if (selRows.size || selCols.size || cellRange) clearSelection();
    focusRow(globalIdx, colPos);
    focusElement(globalIdx, colPos);
  };

  const moveRowFocus = (displayIdx: number, colPos: FocusCol, shiftKey: boolean) => {
    const gi = globalAt(displayIdx);
    if (gi == null) return;
    const globalIdx = gi as number;
    const nextCol = colPos < 0 ? -1 : Math.max(0, Math.min(colIndices.length - 1, colPos));
    const { rows, cols } = selectionRef.current;
    const hasSelection = rows.size > 0 || cols.size > 0 || cellRange != null;

    if (shiftKey && nextCol >= 0) {
      const anchor = resolveShiftAnchor({ row: displayIdx, col: nextCol });
      selectionAnchorRef.current = anchor;
      applyCellRangeSelection(anchor, { row: displayIdx, col: nextCol });
    } else if (!shiftKey && !shiftHeldRef.current && hasSelection) {
      clearSelection();
    }

    focusRow(globalIdx, nextCol);
    focusElement(globalIdx, nextCol);
  };

  // Seeds anchor for a coming shift+click/arrow without clearing an existing selection (Excel-style extension). Callers gate on !e.repeat - Windows repeats modifier keydowns, macOS doesn't.
  const seedShiftAnchor = (displayIdx: number, colPos: FocusCol) => {
    if (colPos < 0) return;
    const { rows, cols } = selectionRef.current;
    if (cellRange || rows.size > 0 || cols.size > 0) return;
    selectionAnchorRef.current = { row: displayIdx, col: colPos };
  };

  return {
    cellRange,
    setCellRange,
    selectedRows,
    setSelectedRows,
    selectedColumns,
    setSelectedColumns,
    focusedRowIdx,
    setFocusedRowIdx,
    focusedColPos,
    setFocusedColPos,
    isSelecting,
    rowAnchorRef,
    columnAnchorRef,
    selectingRef,
    shiftHeldRef,
    selectionRef,
    focusRef,
    clearSelection,
    focusRow,
    focusElement,
    startColResize,
    handleCellMouseDown,
    handleColumnHeaderClick,
    handleRowGutterClick,
    handleCellClick,
    moveRowFocus,
    seedShiftAnchor,
  };
}
