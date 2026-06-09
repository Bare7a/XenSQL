import { useMemo } from 'react';
import { type CellRange, cellRangeDimensions } from '@/shared/lib/gridCellRange';

// Stable empty set so consumers can skip work via identity checks on the no-selection path.
const EMPTY_NUMBER_SET: Set<number> = new Set();

interface UseGridSelectionViewOptions {
  cellRange: CellRange | null;
  selectedRows: Set<number>;
  selectedColumns: Set<string>;
  displayColumns: string[];
  /** Count shown when whole columns are selected. */
  rowCount: number;
  /** Omit for grids without client-side sort (global === display index). */
  sortedIndexOf?: (globalIdx: number) => number;
}

export interface GridSelectionView {
  selectionRowsCount: number;
  selectionColsCount: number;
  /** Display-row indices to band in row-selection mode; empty in cell-range mode. */
  selectedSortedRows: Set<number>;
  /** Display-column positions to band in column-selection mode; empty in cell-range mode. */
  selectedColPositions: Set<number>;
}

export function useGridSelectionView({
  cellRange,
  selectedRows,
  selectedColumns,
  displayColumns,
  rowCount,
  sortedIndexOf,
}: UseGridSelectionViewOptions): GridSelectionView {
  const selectionSize = cellRangeDimensions(cellRange);

  const selectionRowsCount = useMemo(() => {
    if (selectionSize) return selectionSize.rows;
    if (selectedRows.size > 0) return selectedRows.size;
    if (selectedColumns.size > 0) return rowCount;
    return 0;
  }, [selectionSize, selectedRows, selectedColumns, rowCount]);

  const selectionColsCount = useMemo(() => {
    if (selectionSize) return selectionSize.cols;
    if (selectedColumns.size > 0) return selectedColumns.size;
    if (selectedRows.size > 0) return displayColumns.length;
    return 0;
  }, [selectionSize, selectedRows, selectedColumns, displayColumns.length]);

  const selectedSortedRows = useMemo(() => {
    if (cellRange || selectedRows.size === 0) return EMPTY_NUMBER_SET;
    if (!sortedIndexOf) return new Set(selectedRows);
    const s = new Set<number>();
    for (const gi of selectedRows) {
      const si = sortedIndexOf(gi);
      if (si >= 0) s.add(si);
    }
    return s;
  }, [cellRange, selectedRows, sortedIndexOf]);

  const selectedColPositions = useMemo(() => {
    if (cellRange || selectedColumns.size === 0) return EMPTY_NUMBER_SET;
    const posByName = new Map<string, number>();
    for (let i = 0; i < displayColumns.length; i++) posByName.set(displayColumns[i], i);
    const s = new Set<number>();
    for (const col of selectedColumns) {
      const pos = posByName.get(col);
      if (pos != null) s.add(pos);
    }
    return s;
  }, [cellRange, selectedColumns, displayColumns]);

  return { selectionRowsCount, selectionColsCount, selectedSortedRows, selectedColPositions };
}
