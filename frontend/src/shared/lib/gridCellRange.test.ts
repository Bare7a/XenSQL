import { describe, expect, it } from 'vitest';
import {
  cellRangeDimensions,
  cellRangeEdgeClasses,
  fullColsCellRange,
  fullRowsCellRange,
  gridSelectionHighlightClasses,
  isCellInRange,
  normalizeCellRange,
  selectedRowsEdgeClasses,
} from '@/shared/lib/gridCellRange';

describe('normalizeCellRange', () => {
  it('orders corners regardless of drag direction', () => {
    expect(normalizeCellRange({ row: 5, col: 2 }, { row: 1, col: 0 })).toEqual({
      r0: 1,
      r1: 5,
      c0: 0,
      c1: 2,
    });
  });
});

describe('cellRangeEdgeClasses', () => {
  it('marks perimeter cells only', () => {
    const range = { r0: 0, r1: 1, c0: 0, c1: 1 };
    expect(cellRangeEdgeClasses(0, 0, range)).toContain('cell-range-edge-top');
    expect(cellRangeEdgeClasses(0, 0, range)).toContain('cell-range-edge-left');
    expect(cellRangeEdgeClasses(1, 1, range)).toContain('cell-range-edge-bottom');
    expect(isCellInRange(0, 1, range)).toBe(true);
    expect(cellRangeEdgeClasses(0, 1, range)).toContain('cell-range-edge-right');
    expect(cellRangeEdgeClasses(0, 1, range)).not.toContain('cell-range-edge-left');
  });
});

describe('cellRangeDimensions', () => {
  it('returns row and column counts', () => {
    expect(cellRangeDimensions({ r0: 5, r1: 13, c0: 1, c1: 3 })).toEqual({
      rows: 9,
      cols: 3,
    });
  });
});

describe('fullRowsCellRange / fullColsCellRange', () => {
  it('spans all columns for row selection', () => {
    expect(fullRowsCellRange(2, 4, 5)).toEqual({ r0: 2, r1: 4, c0: 0, c1: 4 });
  });

  it('spans all rows for column selection', () => {
    expect(fullColsCellRange(1, 2, 10)).toEqual({ r0: 0, r1: 9, c0: 1, c1: 2 });
  });
});

describe('selectedRowsEdgeClasses', () => {
  it('draws a single band without internal horizontal edges', () => {
    const rows = new Set([1, 2]);
    expect(selectedRowsEdgeClasses(1, 0, rows, 4)).toContain('cell-range-edge-top');
    expect(selectedRowsEdgeClasses(1, 0, rows, 4)).not.toContain('cell-range-edge-bottom');
    expect(selectedRowsEdgeClasses(2, 0, rows, 4)).toContain('cell-range-edge-bottom');
    expect(selectedRowsEdgeClasses(2, 0, rows, 4)).not.toContain('cell-range-edge-top');
  });
});

describe('gridSelectionHighlightClasses', () => {
  it('prefers cell range over row/col bands', () => {
    const range = { r0: 0, r1: 0, c0: 0, c1: 1 };
    const cls = gridSelectionHighlightClasses(0, 0, range, new Set([1]), new Set([2]), 5, 4);
    expect(cls).toBe(cellRangeEdgeClasses(0, 0, range));
  });
});
