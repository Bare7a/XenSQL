import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COL_WIDTH_DEBOUNCE_MS, computeColWidths, SAMPLE_ROWS } from '@/shared/lib/grid';

// Streaming delivers meta with empty rows before the first batch; wait this long before falling back to header-only widths for genuinely-empty results.
const EMPTY_RESULT_FALLBACK_MS = 500;

export interface GridColumnsView {
  columns: string[];
  displayColumns: string[];
  colIndices: number[];
  columnIndexByName: Map<string, number>;
  hiddenColumns: Set<string>;
  toggleColumn: (col: string) => void;
  showAllColumns: () => void;
  hideAllColumns: () => void;
  colWidths: string[];
  /** True once widths are computed for every visible column (safe to show the grid). */
  columnsSized: boolean;
  fitColumns: () => void;
  applyColumnWidth: (colPos: number, widthPx: number) => void;
}

export function useGridColumns(columns: string[], sortedRows: unknown[][]): GridColumnsView {
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [colWidths, setColWidths] = useState<string[]>([]);
  // Columns the user drag-resized - preserved across re-samples so streaming doesn't snap them back.
  const userSizedRef = useRef<Set<number>>(new Set());

  const displayColumns = useMemo(() => columns.filter((c) => !hiddenColumns.has(c)), [columns, hiddenColumns]);

  const columnIndexByName = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < columns.length; i++) m.set(columns[i], i);
    return m;
  }, [columns]);

  const colIndices = useMemo(
    () => displayColumns.map((c) => columnIndexByName.get(c) ?? -1),
    [displayColumns, columnIndexByName],
  );

  const widthsEqual = (a: string[], b: string[]) => a.length === b.length && a.every((w, i) => w === b[i]);

  // State (not ref) so flipping it triggers a re-render that lets `columnsSized` switch on without an extra dep.
  const [sizedFor, setSizedFor] = useState<string[] | null>(null);

  const computeAndSetWidths = useCallback(
    (preserveUserSized = false) => {
      if (!displayColumns.length || !colIndices.length) {
        setSizedFor(null);
        setColWidths((prev) => (prev.length === 0 ? prev : []));
        return;
      }
      const sample = sortedRows.slice(0, SAMPLE_ROWS);
      const next = computeColWidths(displayColumns, colIndices, sample);
      setSizedFor(displayColumns);
      setColWidths((prev) => {
        const merged = preserveUserSized
          ? next.map((w, i) => (userSizedRef.current.has(i) && prev[i] != null ? prev[i] : w))
          : next;
        return widthsEqual(prev, merged) ? prev : merged;
      });
    },
    [displayColumns, colIndices, sortedRows],
  );

  // Stable ref avoids re-firing width computation mid-stream when identity changes on every row update.
  const computeAndSetWidthsRef = useRef(computeAndSetWidths);
  computeAndSetWidthsRef.current = computeAndSetWidths;

  // Streaming mutates the rows array in place - dep on sortedRows.length (primitive) not the array reference.
  useLayoutEffect(() => {
    if (!displayColumns.length) return;
    if (sizedFor === displayColumns) return;
    if (sortedRows.length === 0) return;
    // New column set - drop stale manual overrides.
    userSizedRef.current.clear();
    computeAndSetWidthsRef.current();
  }, [displayColumns, sortedRows.length, sizedFor]);

  // Fallback for genuinely-empty results: commit header-only widths after delay so the grid can render.
  useEffect(() => {
    if (!displayColumns.length) return;
    if (sizedFor === displayColumns) return;
    const timer = setTimeout(() => {
      userSizedRef.current.clear();
      computeAndSetWidthsRef.current();
    }, EMPTY_RESULT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [displayColumns, sizedFor]);

  // Debounced re-sample when rows grow past the initial sample (load-more with wider values); dep on length not ref.
  useEffect(() => {
    if (!displayColumns.length) return;
    if (sortedRows.length === 0) return;
    if (sizedFor !== displayColumns) return;
    const timer = setTimeout(() => computeAndSetWidthsRef.current(true), COL_WIDTH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [sortedRows.length, displayColumns, sizedFor]);

  const columnsSized =
    displayColumns.length > 0 && colWidths.length === displayColumns.length && sizedFor === displayColumns;

  const fitColumns = useCallback(() => {
    userSizedRef.current.clear();
    computeAndSetWidths();
  }, [computeAndSetWidths]);

  const toggleColumn = useCallback((col: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  }, []);

  const showAllColumns = useCallback(() => {
    setHiddenColumns(new Set());
  }, []);

  const hideAllColumns = useCallback(() => {
    setHiddenColumns(new Set(columns));
  }, [columns]);

  const applyColumnWidth = useCallback((colPos: number, widthPx: number) => {
    userSizedRef.current.add(colPos);
    setColWidths((prev) => {
      const copy = [...prev];
      copy[colPos] = `${widthPx}px`;
      return copy;
    });
  }, []);

  return {
    columns,
    displayColumns,
    colIndices,
    columnIndexByName,
    hiddenColumns,
    toggleColumn,
    showAllColumns,
    hideAllColumns,
    colWidths,
    columnsSized,
    fitColumns,
    applyColumnWidth,
  };
}
