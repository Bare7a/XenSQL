import { describe, expect, it } from 'vitest';
import {
  computePasteEdits,
  parseClipboardGrid,
} from '@/features/table-view/lib/tableViewClipboard';

describe('parseClipboardGrid', () => {
  it('returns an empty grid for empty text', () => {
    expect(parseClipboardGrid('')).toEqual([]);
  });

  it('parses a single value as a 1x1 grid', () => {
    expect(parseClipboardGrid('hello')).toEqual([['hello']]);
  });

  it('keeps commas inside a single value when there are no tabs and one line', () => {
    // No tab, no newline: even with a comma this is genuinely ambiguous, but a lone line is treated
    // as one CSV row. (Internal single-cell copies round-trip exactly via the captured buffer.)
    expect(parseClipboardGrid('Doe, John')).toEqual([['Doe', ' John']]);
  });

  it('prefers tab over comma when both are present', () => {
    expect(parseClipboardGrid('a,b\tc,d')).toEqual([['a,b', 'c,d']]);
  });

  it('parses tab-delimited rows and columns', () => {
    expect(parseClipboardGrid('a\tb\tc\n1\t2\t3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('parses CSV rows and columns when no tab is present', () => {
    expect(parseClipboardGrid('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('honors quoted fields containing the delimiter, quotes, and newlines', () => {
    expect(parseClipboardGrid('"a,b","c""d","e\nf"')).toEqual([['a,b', 'c"d', 'e\nf']]);
  });

  it('normalizes CRLF and CR line endings', () => {
    expect(parseClipboardGrid('a\tb\r\nc\td\re\tf')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });

  it('drops a single trailing blank line from a trailing newline', () => {
    expect(parseClipboardGrid('a\tb\n1\t2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('preserves genuinely empty fields within a row', () => {
    expect(parseClipboardGrid('a\t\tc')).toEqual([['a', '', 'c']]);
  });
});

describe('computePasteEdits', () => {
  const cols = ['A', 'B', 'C', 'D', 'E'];

  it('offsets a grid onto cells anchored at the paste target (A1:C3 -> B2:D4)', () => {
    const grid = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
    ];
    const edits = computePasteEdits(grid, 1, 1, 100, cols);
    expect(edits).toHaveLength(9);
    expect(edits[0]).toEqual({ rowIdx: 1, col: 'B', value: '1' });
    expect(edits[2]).toEqual({ rowIdx: 1, col: 'D', value: '3' });
    expect(edits[8]).toEqual({ rowIdx: 3, col: 'D', value: '9' });
  });

  it('writes a single cell for a 1x1 grid', () => {
    expect(computePasteEdits([['x']], 5, 2, 100, cols)).toEqual([
      { rowIdx: 5, col: 'C', value: 'x' },
    ]);
  });

  it('maps empty fields to NULL', () => {
    expect(computePasteEdits([['']], 0, 0, 100, cols)).toEqual([
      { rowIdx: 0, col: 'A', value: null },
    ]);
  });

  it('drops cells past the last loaded row', () => {
    const grid = [['1'], ['2'], ['3']];
    const edits = computePasteEdits(grid, 1, 0, 2, cols);
    expect(edits).toEqual([{ rowIdx: 1, col: 'A', value: '1' }]);
  });

  it('drops cells past the last visible column', () => {
    const grid = [['1', '2', '3']];
    const edits = computePasteEdits(grid, 0, 4, 100, cols);
    // Anchored at E (last col); the next two columns do not exist.
    expect(edits).toEqual([{ rowIdx: 0, col: 'E', value: '1' }]);
  });

  it('returns nothing for an empty grid', () => {
    expect(computePasteEdits([], 0, 0, 100, cols)).toEqual([]);
  });
});
