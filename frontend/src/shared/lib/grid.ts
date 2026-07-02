import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ExportFormat } from '@/shared/lib/exportResult';

// padding-y + line-height from `.data-table td` in global.css; 1px border kept in px so it stays crisp across zoom
const ROW_HEIGHT_REM = 0.308 * 2 + 1.231;
const ROW_HEIGHT_BORDER_PX = 1;

/** Matches natural rendered `.data-table td` height so virtualizer slots align with cells. */
export function rowHeightForZoom(uiZoomPx: number): number {
  return Math.round(uiZoomPx * ROW_HEIGHT_REM) + ROW_HEIGHT_BORDER_PX;
}

export const OVERSCAN = 12;
const COL_MIN_CH = 8;
export const COL_MAX_CH = 50;
const COL_PAD_CH = 3;
// Sort chevron in header - treat as extra chars so auto-fit doesn't undersize
const COL_HEADER_ICON_CH = 4;
export const SAMPLE_ROWS = 80;
export const COL_WIDTH_DEBOUNCE_MS = 150;

/** Data columns 0..N-1; -1 is the row-number gutter. */
export type FocusCol = number;

export type SortDirection = 'ASC' | 'DESC';

export function primaryKeyKey(pk: Record<string, unknown>): string {
  const keys = Object.keys(pk).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys) ordered[k] = pk[k];
  return JSON.stringify(ordered);
}

export function rowPrimaryKey(row: unknown[], columns: string[], primaryKeys: string[]): Record<string, unknown> {
  const pk: Record<string, unknown> = {};
  for (const col of primaryKeys) {
    const idx = columns.indexOf(col);
    if (idx >= 0) pk[col] = row[idx];
  }
  return pk;
}

/** Only used by copy/export; render path uses the null-sentinel in useGridSort. */
export function identityIndices(n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

export function computeColWidths(displayColumns: string[], colIndices: number[], sampleRows: unknown[][]): string[] {
  return displayColumns.map((header, i) => {
    const ci = colIndices[i];
    let maxLen = header.length + COL_HEADER_ICON_CH;
    for (const row of sampleRows) {
      const cell = row[ci];
      if (cell != null) {
        const len = String(cell).length;
        if (len > maxLen) maxLen = len;
        if (maxLen >= COL_MAX_CH) break;
      }
    }
    return `${Math.min(COL_MAX_CH, Math.max(COL_MIN_CH, maxLen + COL_PAD_CH))}ch`;
  });
}

/** null sortedRowIndices = unsorted view; skips O(N) indexOf and the identity array. */
export function rowRangeSet(
  sortedRowIndices: number[] | null,
  rowCount: number,
  fromGlobal: number,
  toGlobal: number,
  keepExisting: boolean,
  existing: Set<number>,
): Set<number> {
  const next = keepExisting ? new Set(existing) : new Set<number>();
  if (sortedRowIndices == null) {
    if (fromGlobal < 0 || toGlobal < 0 || fromGlobal >= rowCount || toGlobal >= rowCount) {
      next.add(toGlobal);
      return next;
    }
    const [lo, hi] = fromGlobal <= toGlobal ? [fromGlobal, toGlobal] : [toGlobal, fromGlobal];
    for (let k = lo; k <= hi; k++) next.add(k);
    return next;
  }
  const a = sortedRowIndices.indexOf(fromGlobal);
  const b = sortedRowIndices.indexOf(toGlobal);
  if (a < 0 || b < 0) {
    next.add(toGlobal);
    return next;
  }
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let k = lo; k <= hi; k++) next.add(sortedRowIndices[k]);
  return next;
}

export function columnRangeSet(
  displayColumns: string[],
  fromCol: string,
  toCol: string,
  keepExisting: boolean,
  existing: Set<string>,
): Set<string> {
  const a = displayColumns.indexOf(fromCol);
  const b = displayColumns.indexOf(toCol);
  const next = keepExisting ? new Set(existing) : new Set<string>();
  if (a < 0 || b < 0) {
    next.add(toCol);
    return next;
  }
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let k = lo; k <= hi; k++) next.add(displayColumns[k]);
  return next;
}

export function handleGridArrowKey(
  e: ReactKeyboardEvent,
  displayRowIdx: number,
  colPos: FocusCol,
  rowCount: number,
  colCount: number,
  moveRowFocus: (rowIdx: number, colPos: FocusCol, shift: boolean) => void,
): boolean {
  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault();
      if (colPos < colCount - 1) moveRowFocus(displayRowIdx, colPos + 1, e.shiftKey);
      else if (colPos === -1 && colCount > 0) moveRowFocus(displayRowIdx, 0, e.shiftKey);
      return true;
    case 'ArrowLeft':
      e.preventDefault();
      if (colPos > 0) moveRowFocus(displayRowIdx, colPos - 1, e.shiftKey);
      else if (colPos === 0) moveRowFocus(displayRowIdx, -1, e.shiftKey);
      return true;
    case 'ArrowDown':
      e.preventDefault();
      if (displayRowIdx < rowCount - 1) moveRowFocus(displayRowIdx + 1, colPos, e.shiftKey);
      return true;
    case 'ArrowUp':
      e.preventDefault();
      if (displayRowIdx > 0) moveRowFocus(displayRowIdx - 1, colPos, e.shiftKey);
      return true;
  }
  return false;
}

export function exportFormatLabel(t: (key: string) => string, format: ExportFormat): string {
  const keys: Record<ExportFormat, string> = {
    text: 'export.formatText',
    csv: 'export.formatCsv',
    json: 'export.formatJson',
    markdown: 'export.formatMarkdown',
    sql: 'export.formatSql',
  };
  return t(keys[format]);
}
