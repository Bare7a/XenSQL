import { useCallback, useMemo, useState } from 'react';
import type { SortDirection } from '@/shared/lib/grid';

export type { SortDirection };

export interface GridSortView {
  sortCol: string | null;
  sortDir: SortDirection;
  handleColumnSort: (col: string) => void;
  resetSort: () => void;
  /** Aliases the input rows when unsorted - no copy. */
  sortedRows: unknown[][];
  /** null when unsorted (positions equal indices). */
  sortedRowIndices: number[] | null;
  /** Inverse of sortedRowIndices; null when unsorted. */
  globalToSortedIdx: Map<number, number> | null;
  globalIndexAt: (sortedIdx: number) => number;
  sortedIndexOf: (globalIdx: number) => number;
}

interface SortState {
  col: string | null;
  dir: SortDirection;
}

const INITIAL_SORT: SortState = { col: null, dir: 'ASC' };

// One cached collator: building it per comparison (what String.localeCompare with an options object
// effectively does) is ~100x slower over a large sort.
const naturalCollator = new Intl.Collator(undefined, { numeric: true });

// localeCompare(numeric) ignores the minus sign, so compare numbers/booleans by value directly.
export function compareCellValues(av: unknown, bv: unknown): number {
  if (typeof av === 'number' && typeof bv === 'number') {
    // NaN isn't ordered by </>; sort it to the end (like nulls) instead of comparing equal to everything.
    const aNan = Number.isNaN(av);
    const bNan = Number.isNaN(bv);
    if (aNan || bNan) return aNan && bNan ? 0 : aNan ? 1 : -1;
    return av < bv ? -1 : av > bv ? 1 : 0;
  }
  if (typeof av === 'boolean' && typeof bv === 'boolean') {
    return av === bv ? 0 : av ? 1 : -1;
  }
  return naturalCollator.compare(String(av), String(bv));
}

export function useGridSort(rows: unknown[][], columns: string[]): GridSortView {
  // Single state object so the toggle stays a pure updater - separate setters caused a StrictMode double-flip that broke descending sort.
  const [{ col: sortCol, dir: sortDir }, setSort] = useState<SortState>(INITIAL_SORT);

  const handleColumnSort = useCallback((col: string) => {
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 'ASC' ? 'DESC' : 'ASC' } : { col, dir: 'ASC' }));
  }, []);

  const resetSort = useCallback(() => {
    setSort(INITIAL_SORT);
  }, []);

  // Streaming batches mutate rows in place; depending on rows.length forces re-sort on each append.
  const { sortedRows, sortedRowIndices } = useMemo<{
    sortedRows: unknown[][];
    sortedRowIndices: number[] | null;
  }>(() => {
    if (!sortCol) {
      return { sortedRows: rows, sortedRowIndices: null };
    }
    if (!rows.length) {
      return { sortedRows: rows, sortedRowIndices: null };
    }

    const colIdx = columns.indexOf(sortCol);
    const n = rows.length;
    const order = new Array<number>(n);
    for (let i = 0; i < n; i++) order[i] = i;
    // null/NaN always sort last (not flipped by direction); everything else flips with dirMul.
    const dirMul = sortDir === 'ASC' ? 1 : -1;

    // Fast path: a purely numeric column skips string conversion and collation entirely.
    let numericOnly = true;
    for (let i = 0; i < n; i++) {
      const v = rows[i][colIdx];
      if (v != null && typeof v !== 'number') {
        numericOnly = false;
        break;
      }
    }

    if (numericOnly) {
      order.sort((ia, ib) => {
        const av = rows[ia][colIdx] as number | null;
        const bv = rows[ib][colIdx] as number | null;
        if (av == null) return bv == null ? 0 : 1;
        if (bv == null) return -1;
        const aNan = Number.isNaN(av);
        const bNan = Number.isNaN(bv);
        if (aNan || bNan) return aNan && bNan ? 0 : aNan ? 1 : -1;
        return av === bv ? 0 : (av < bv ? -1 : 1) * dirMul;
      });
    } else {
      // Decorate once: pre-stringify the sort column so collation runs O(n) String() calls instead
      // of one per comparison (O(n log n)).
      const keys = new Array<string | null>(n);
      for (let i = 0; i < n; i++) {
        const v = rows[i][colIdx];
        keys[i] = v == null ? null : String(v);
      }
      order.sort((ia, ib) => {
        const ak = keys[ia];
        const bk = keys[ib];
        if (ak == null) return bk == null ? 0 : 1;
        if (bk == null) return -1;
        return naturalCollator.compare(ak, bk) * dirMul;
      });
    }

    const sorted = new Array<unknown[]>(n);
    for (let i = 0; i < n; i++) sorted[i] = rows[order[i]];
    return { sortedRows: sorted, sortedRowIndices: order };
  }, [rows, rows.length, columns, sortCol, sortDir]);

  const globalToSortedIdx = useMemo<Map<number, number> | null>(() => {
    if (sortedRowIndices == null) return null;
    const m = new Map<number, number>();
    for (let i = 0; i < sortedRowIndices.length; i++) {
      m.set(sortedRowIndices[i], i);
    }
    return m;
  }, [sortedRowIndices]);

  const globalIndexAt = useCallback(
    (sortedIdx: number) => (sortedRowIndices == null ? sortedIdx : sortedRowIndices[sortedIdx]),
    [sortedRowIndices],
  );

  const sortedIndexOf = useCallback(
    (globalIdx: number) => {
      if (globalToSortedIdx == null) {
        return globalIdx >= 0 && globalIdx < sortedRows.length ? globalIdx : -1;
      }
      return globalToSortedIdx.get(globalIdx) ?? -1;
    },
    [globalToSortedIdx, sortedRows.length],
  );

  return {
    sortCol,
    sortDir,
    handleColumnSort,
    resetSort,
    sortedRows,
    sortedRowIndices,
    globalToSortedIdx,
    globalIndexAt,
    sortedIndexOf,
  };
}
