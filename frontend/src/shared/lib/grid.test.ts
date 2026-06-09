import { describe, expect, it } from 'vitest';
import { columnRangeSet, computeColWidths, exportFormatLabel, identityIndices, rowRangeSet } from '@/shared/lib/grid';

describe('identityIndices', () => {
  it('returns [0..n-1]', () => {
    expect(identityIndices(0)).toEqual([]);
    expect(identityIndices(1)).toEqual([0]);
    expect(identityIndices(4)).toEqual([0, 1, 2, 3]);
  });
});

describe('computeColWidths', () => {
  it('clamps within [MIN, MAX] ch and pads the header', () => {
    const out = computeColWidths(
      ['id', 'name'],
      [0, 1],
      [
        [1, 'alice'],
        [2, 'a-very-long-username-that-overflows'],
      ],
    );
    expect(out[0]).toBe('9ch');
    expect(out[1]).toBe('38ch');
  });

  it('caps very long values at COL_MAX_CH', () => {
    const huge = 'x'.repeat(200);
    const [w] = computeColWidths(['col'], [0], [[huge]]);
    expect(w).toBe('50ch');
  });

  it('returns header+chevron width for an empty result', () => {
    expect(computeColWidths(['hello'], [0], [])).toEqual(['12ch']);
  });

  it('still uses header+chevron when a short column has only short data', () => {
    const [w] = computeColWidths(['id'], [0], [[1], [2], [3]]);
    expect(w).toBe('9ch');
  });
});

describe('rowRangeSet (identity / unsorted fast path)', () => {
  const empty = new Set<number>();

  it('builds an inclusive range over global indices', () => {
    expect(rowRangeSet(null, 10, 2, 5, false, empty)).toEqual(new Set([2, 3, 4, 5]));
  });

  it('handles reversed from/to', () => {
    expect(rowRangeSet(null, 10, 5, 2, false, empty)).toEqual(new Set([2, 3, 4, 5]));
  });

  it('preserves existing entries when keepExisting=true', () => {
    expect(rowRangeSet(null, 10, 2, 3, true, new Set([7, 8]))).toEqual(new Set([2, 3, 7, 8]));
  });

  it('out-of-range collapses to just the target', () => {
    expect(rowRangeSet(null, 5, -1, 100, false, empty)).toEqual(new Set([100]));
  });
});

describe('rowRangeSet (sorted view)', () => {
  const sorted = [3, 1, 4, 1, 5, 9, 2, 6];

  it('range walks the view positions and emits the globals', () => {
    // sorted=[3,1,4,1,5,9,2,6]; global 1→pos 1, global 5→pos 4; positions 1..4 → globals [1,4,1,5] → set {1,4,5}
    expect(rowRangeSet(sorted, sorted.length, 1, 5, false, new Set())).toEqual(new Set([1, 4, 5]));
  });

  it('unknown global falls through to just the target', () => {
    expect(rowRangeSet(sorted, sorted.length, 1, 999, false, new Set())).toEqual(new Set([999]));
  });
});

describe('columnRangeSet', () => {
  const cols = ['id', 'name', 'note', 'score'];

  it('range between two column names', () => {
    expect(columnRangeSet(cols, 'name', 'score', false, new Set())).toEqual(new Set(['name', 'note', 'score']));
  });

  it('reversed range', () => {
    expect(columnRangeSet(cols, 'score', 'name', false, new Set())).toEqual(new Set(['name', 'note', 'score']));
  });

  it('keeps existing when asked', () => {
    expect(columnRangeSet(cols, 'id', 'name', true, new Set(['note']))).toEqual(new Set(['id', 'name', 'note']));
  });

  it('unknown column falls through to target', () => {
    expect(columnRangeSet(cols, 'gone', 'name', false, new Set())).toEqual(new Set(['name']));
  });
});

describe('exportFormatLabel', () => {
  it('maps each ExportFormat to its i18n key', () => {
    const calls: string[] = [];
    const fakeT = (k: string) => {
      calls.push(k);
      return `label:${k}`;
    };
    expect(exportFormatLabel(fakeT, 'text')).toBe('label:export.formatText');
    expect(exportFormatLabel(fakeT, 'csv')).toBe('label:export.formatCsv');
    expect(exportFormatLabel(fakeT, 'json')).toBe('label:export.formatJson');
    expect(exportFormatLabel(fakeT, 'markdown')).toBe('label:export.formatMarkdown');
    expect(exportFormatLabel(fakeT, 'sql')).toBe('label:export.formatSql');
    expect(calls).toEqual([
      'export.formatText',
      'export.formatCsv',
      'export.formatJson',
      'export.formatMarkdown',
      'export.formatSql',
    ]);
  });
});
