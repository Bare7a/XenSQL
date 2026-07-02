import type { Virtualizer } from '@tanstack/react-virtual';
import { queryElementInContainer } from '@/shared/lib/dom';
import type { FocusCol } from '@/shared/lib/grid';
import { findGridCellElement } from '@/shared/lib/gridCellRange';
import { adjustGridCellScrollInWrap } from '@/shared/lib/gridScroll';

export type GridCellFocus = { row: number; colPos: FocusCol };

/** Valid focus from state, or (0, 0) when row is null. */
export function resolveGridCellFocus(
  row: number | null,
  colPos: FocusCol,
  rowCount: number,
  colCount: number,
): GridCellFocus | null {
  if (rowCount === 0 || colCount === 0) return null;
  if (row != null && colPos >= 0 && row < rowCount && colPos < colCount) {
    return { row, colPos };
  }
  return { row: 0, colPos: 0 };
}

function getGridCellElement(
  wrap: HTMLElement | null,
  row: number,
  colPos: FocusCol,
  cellId: string,
): HTMLElement | null {
  return findGridCellElement(wrap, row, colPos) ?? queryElementInContainer(wrap, cellId);
}

interface FocusGridCellDomOptions {
  wrap: HTMLElement | null;
  row: number;
  colPos: FocusCol;
  cellId: string;
  scrollRow: boolean;
  rowHeight: number;
  scrollToRow?: () => void;
  /** Runs on attempt 0 (e.g. restore scroll after refresh). */
  onFirstAttempt?: () => void;
}

/** Focus a virtualized grid cell; one extra frame if the row is not mounted yet. */
export function focusGridCellDom({
  wrap,
  row,
  colPos,
  cellId,
  scrollRow,
  rowHeight,
  scrollToRow,
  onFirstAttempt,
}: FocusGridCellDomOptions): void {
  const tryFocus = () => {
    const el = getGridCellElement(wrap, row, colPos, cellId);
    if (!el || !wrap) return false;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    adjustGridCellScrollInWrap(wrap, el, {
      rowsAbove: scrollRow ? 1 : 0,
      rowHeight,
    });
    return true;
  };

  const run = () => {
    onFirstAttempt?.();
    scrollToRow?.();
    if (tryFocus()) return;
    requestAnimationFrame(tryFocus);
  };

  requestAnimationFrame(run);
}

export function scrollVirtualizerToRow(rowVirtualizer: Virtualizer<HTMLDivElement, Element>, row: number): void {
  rowVirtualizer.scrollToIndex(Math.max(0, row - 1), { align: 'start' });
}
