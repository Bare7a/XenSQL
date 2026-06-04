export interface CellRange {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export interface CellCoord {
  row: number;
  col: number;
}

export function normalizeCellRange(anchor: CellCoord, current: CellCoord): CellRange {
  return {
    r0: Math.min(anchor.row, current.row),
    r1: Math.max(anchor.row, current.row),
    c0: Math.min(anchor.col, current.col),
    c1: Math.max(anchor.col, current.col),
  };
}

export function fullRowsCellRange(r0: number, r1: number, colCount: number): CellRange {
  const lastCol = Math.max(0, colCount - 1);
  return {
    r0: Math.min(r0, r1),
    r1: Math.max(r0, r1),
    c0: 0,
    c1: lastCol,
  };
}

export function fullColsCellRange(c0: number, c1: number, rowCount: number): CellRange {
  const lastRow = Math.max(0, rowCount - 1);
  return {
    r0: 0,
    r1: lastRow,
    c0: Math.min(c0, c1),
    c1: Math.max(c0, c1),
  };
}

export function isCellInRange(row: number, col: number, range: CellRange | null): boolean {
  if (!range) return false;
  return row >= range.r0 && row <= range.r1 && col >= range.c0 && col <= range.c1;
}

export function cellRangeEdgeClasses(row: number, col: number, range: CellRange | null): string {
  if (!range || !isCellInRange(row, col, range)) return '';
  const classes = ['cell-range-selected'];
  if (row === range.r0) classes.push('cell-range-edge-top');
  if (row === range.r1) classes.push('cell-range-edge-bottom');
  if (col === range.c0) classes.push('cell-range-edge-left');
  if (col === range.c1) classes.push('cell-range-edge-right');
  return classes.join(' ');
}

export function selectedRowsEdgeClasses(
  row: number,
  col: number,
  selectedRows: Set<number>,
  colCount: number
): string {
  if (!selectedRows.has(row)) return '';
  const classes = ['cell-range-selected'];
  if (!selectedRows.has(row - 1)) classes.push('cell-range-edge-top');
  if (!selectedRows.has(row + 1)) classes.push('cell-range-edge-bottom');
  if (col === 0) classes.push('cell-range-edge-left');
  if (col === colCount - 1) classes.push('cell-range-edge-right');
  return classes.join(' ');
}

export function selectedColsEdgeClasses(
  row: number,
  col: number,
  selectedCols: Set<number>,
  rowCount: number
): string {
  if (!selectedCols.has(col)) return '';
  const classes = ['cell-range-selected'];
  if (row === 0) classes.push('cell-range-edge-top');
  if (row === rowCount - 1) classes.push('cell-range-edge-bottom');
  if (!selectedCols.has(col - 1)) classes.push('cell-range-edge-left');
  if (!selectedCols.has(col + 1)) classes.push('cell-range-edge-right');
  return classes.join(' ');
}

export function gridSelectionHighlightClasses(
  row: number,
  col: number,
  cellRange: CellRange | null,
  selectedRows: Set<number>,
  selectedCols: Set<number>,
  rowCount: number,
  colCount: number
): string {
  if (cellRange) return cellRangeEdgeClasses(row, col, cellRange);
  if (selectedRows.size > 0) return selectedRowsEdgeClasses(row, col, selectedRows, colCount);
  if (selectedCols.size > 0) return selectedColsEdgeClasses(row, col, selectedCols, rowCount);
  return '';
}

export function cellRangeDimensions(range: CellRange | null): { rows: number; cols: number } | null {
  if (!range) return null;
  return {
    rows: range.r1 - range.r0 + 1,
    cols: range.c1 - range.c0 + 1,
  };
}

export function findDataCellAtPoint(
  root: HTMLElement | null,
  clientX: number,
  clientY: number
): CellCoord | null {
  if (!root) return null;
  const el = document.elementFromPoint(clientX, clientY);
  const td = el?.closest('td[data-row][data-col-pos]') as HTMLElement | null;
  if (!td || !root.contains(td)) return null;
  const row = Number(td.dataset.row);
  const col = Number(td.dataset.colPos);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { row, col };
}

export function findGridCellElement(
  root: HTMLElement | null,
  row: number,
  colPos: number
): HTMLElement | null {
  if (!root || colPos < 0) return null;
  return root.querySelector<HTMLElement>(
    `td.cell-focusable[data-row="${row}"][data-col-pos="${colPos}"]`
  );
}
