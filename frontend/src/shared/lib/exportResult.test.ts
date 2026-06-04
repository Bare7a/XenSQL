import { describe, expect, it } from 'vitest';
import {
  buildExport,
  exportResultToText,
  formatCellCopyValue,
  resolveCopySelection,
  shouldCopySingleCell,
} from '@/shared/lib/exportResult';
import type { QueryResult } from '@/types';

function sample(): QueryResult {
  return {
    columns: ['id', 'name', 'note'],
    columnTypes: ['int', 'text', 'text'],
    rows: [
      [1, 'alice', 'hello, world'],
      [2, null, 'has "quote"'],
      [3, 'eve', null],
    ],
    rowCount: 3,
    affectedRows: 0,
    durationMs: 0,
    tableName: 'people',
  };
}

describe('exportResultToText - json', () => {
  it('emits an array of objects with original key order', () => {
    const out = exportResultToText(sample(), 'json');
    const parsed = JSON.parse(out);
    expect(parsed).toEqual([
      { id: 1, name: 'alice', note: 'hello, world' },
      { id: 2, name: null, note: 'has "quote"' },
      { id: 3, name: 'eve', note: null },
    ]);
  });

  it('nests JSON/JSONB columns instead of string-wrapping them', () => {
    const r: QueryResult = {
      columns: ['id', 'data'],
      columnTypes: ['int', 'jsonb'],
      rows: [[1, '{"a":1,"b":[2,3]}']],
      rowCount: 1,
      affectedRows: 0,
      durationMs: 0,
      tableName: 't',
    };
    const out = JSON.parse(exportResultToText(r, 'json'));
    expect(out[0].data).toEqual({ a: 1, b: [2, 3] });
    expect(out[0].id).toBe(1);
  });

  it('leaves a non-JSON text column that looks like JSON as a string', () => {
    const r: QueryResult = {
      columns: ['note'],
      columnTypes: ['text'],
      rows: [['{"not":"parsed"}']],
      rowCount: 1,
      affectedRows: 0,
      durationMs: 0,
      tableName: 't',
    };
    const out = JSON.parse(exportResultToText(r, 'json'));
    expect(out[0].note).toBe('{"not":"parsed"}');
  });
});

describe('exportResultToText - csv', () => {
  it('quotes cells with delimiters / quotes / newlines and doubles inner quotes', () => {
    const out = exportResultToText(sample(), 'csv');
    const lines = out.split('\n');
    expect(lines[0]).toBe('id,name,note');
    expect(lines[1]).toBe('1,alice,"hello, world"');
    expect(lines[2]).toBe('2,,"has ""quote"""');
  });
  it('renders null cells as empty fields', () => {
    const out = exportResultToText(sample(), 'csv');
    expect(out).toContain('3,eve,\n'.trimEnd());
  });
  it('quotes leading-whitespace fields and the \\. sentinel (matching Go csv)', () => {
    const r: QueryResult = {
      columns: ['v'],
      columnTypes: ['text'],
      rows: [[' lead'], ['mid dle'], ['\\.']],
      rowCount: 3,
      affectedRows: 0,
      durationMs: 0,
      tableName: 't',
    };
    const lines = exportResultToText(r, 'csv').split('\n');
    expect(lines[1]).toBe('" lead"'); // leading space -> quoted
    expect(lines[2]).toBe('mid dle'); // interior space -> not quoted
    expect(lines[3]).toBe('"\\."'); // \. sentinel -> quoted
  });
});

describe('exportResultToText - markdown', () => {
  it('writes header, separator, and escaped pipes', () => {
    const r = sample();
    r.rows.push([4, 'a|b', 'c']);
    const lines = exportResultToText(r, 'markdown').split('\n');
    expect(lines[0]).toBe('| id | name | note |');
    expect(lines[1]).toBe('| --- | --- | --- |');
    expect(lines[lines.length - 1]).toContain('a\\|b');
  });
});

describe('exportResultToText - markdown header escaping', () => {
  it('escapes pipes in column names so the table alignment survives', () => {
    const r: QueryResult = {
      columns: ['a|b', 'x'],
      columnTypes: ['text', 'text'],
      rows: [['1', '2']],
      rowCount: 1,
      affectedRows: 0,
      durationMs: 0,
    };
    const lines = exportResultToText(r, 'markdown').split('\n');
    expect(lines[0]).toBe('| a\\|b | x |');
  });
});

describe('exportResultToText - bigint cells', () => {
  it('emits bigint as a bare SQL literal and a JSON number without throwing', () => {
    const r: QueryResult = {
      columns: ['id'],
      columnTypes: ['bigint'],
      rows: [[10n]],
      rowCount: 1,
      affectedRows: 0,
      durationMs: 0,
      tableName: 't',
    };
    expect(exportResultToText(r, 'sql')).toContain('VALUES (10)');
    expect(JSON.parse(exportResultToText(r, 'json'))).toEqual([{ id: 10 }]);
  });
});

describe('exportResultToText - text', () => {
  it('joins cells with tab and rows with newline', () => {
    const out = exportResultToText(sample(), 'text');
    expect(out).toBe('1\talice\thello, world\n2\t\thas "quote"\n3\teve\t');
  });
});

describe('exportResultToText - sql', () => {
  it('emits INSERTs that escape single quotes and use NULL for missing values', () => {
    const out = exportResultToText(sample(), 'sql');
    expect(out).toContain('INSERT INTO "people"');
    expect(out).toContain(`'has "quote"'`);
    expect(out).toContain('VALUES (1,');
    expect(out).toContain(', NULL);');
  });
  it("doubles single quotes inside string values", () => {
    const r: QueryResult = {
      columns: ['name'],
      columnTypes: ['text'],
      rows: [["O'Reilly"]],
      rowCount: 1,
      affectedRows: 0,
      durationMs: 0,
      tableName: 'authors',
    };
    expect(exportResultToText(r, 'sql')).toContain("'O''Reilly'");
  });
  it('renders booleans as TRUE/FALSE keywords (matching the Go exporter)', () => {
    const r: QueryResult = {
      columns: ['active'],
      columnTypes: ['bool'],
      rows: [[true], [false]],
      rowCount: 2,
      affectedRows: 0,
      durationMs: 0,
      tableName: 'flags',
    };
    const out = exportResultToText(r, 'sql');
    expect(out).toContain('VALUES (TRUE)');
    expect(out).toContain('VALUES (FALSE)');
  });
  it('falls back to a "results" table when none is set', () => {
    const r: QueryResult = {
      columns: ['id'],
      columnTypes: ['int'],
      rows: [[1]],
      rowCount: 1,
      affectedRows: 0,
      durationMs: 0,
      tableName: '',
    };
    expect(exportResultToText(r, 'sql')).toContain('INSERT INTO "results"');
  });
});

describe('exportResultToText - sql identifier escaping', () => {
  it('doubles embedded double-quotes in table and column names', () => {
    const r: QueryResult = {
      columns: ['wei"rd'],
      columnTypes: ['text'],
      rows: [[1]],
      rowCount: 1,
      affectedRows: 0,
      durationMs: 0,
      tableName: 'tab"le',
    };
    expect(exportResultToText(r, 'sql')).toContain('INSERT INTO "tab""le" ("wei""rd")');
  });
});

describe('exportResultToText - csv formula injection', () => {
  it('quote-prefixes formula-triggering cells but leaves plain numbers untouched', () => {
    const r: QueryResult = {
      columns: ['v'],
      columnTypes: ['text'],
      rows: [['=1+1'], ['@SUM(A1)'], ['-5'], ['+3.2'], ['plain']],
      rowCount: 5,
      affectedRows: 0,
      durationMs: 0,
      tableName: 't',
    };
    const lines = exportResultToText(r, 'csv').split('\n');
    expect(lines[1]).toBe("'=1+1");
    expect(lines[2]).toBe("'@SUM(A1)");
    expect(lines[3]).toBe('-5'); // negative number preserved
    expect(lines[4]).toBe('+3.2'); // signed number preserved
    expect(lines[5]).toBe('plain');
  });
});

describe('exportResultToText - markdown carriage returns', () => {
  it('flattens CRLF and bare CR to spaces', () => {
    const r: QueryResult = {
      columns: ['v'],
      columnTypes: ['text'],
      rows: [['a\r\nb'], ['c\rd']],
      rowCount: 2,
      affectedRows: 0,
      durationMs: 0,
      tableName: 't',
    };
    const out = exportResultToText(r, 'markdown');
    expect(out).not.toContain('\r');
    const lines = out.split('\n');
    expect(lines[2]).toBe('| a b |');
    expect(lines[3]).toBe('| c d |');
  });
});

describe('buildExport', () => {
  it('respects the column subset and row order from opts', () => {
    const out = buildExport(sample(), 'csv', {
      columns: ['note', 'id'],
      rowIndices: [2, 0],
    });
    const lines = out.split('\n');
    expect(lines[0]).toBe('note,id');
    expect(lines[1]).toBe(',3');
    expect(lines[2]).toBe('"hello, world",1');
  });
  it('silently drops unknown columns', () => {
    const out = buildExport(sample(), 'csv', {
      columns: ['nope', 'id'],
      rowIndices: [0],
    });
    expect(out.split('\n')[0]).toBe('id');
  });
});

describe('resolveCopySelection', () => {
  const baseState = {
    displayColumns: ['id', 'name', 'note'],
    sortedRowIndices: [2, 0, 1],
  };

  it('full result when nothing is selected', () => {
    const out = resolveCopySelection({
      ...baseState,
      selectedRows: [],
      selectedColumns: [],
    });
    expect(out.columns).toEqual(['id', 'name', 'note']);
    expect(out.rowIndices).toEqual([2, 0, 1]);
  });

  it('restricts to selected columns when only columns are selected', () => {
    const out = resolveCopySelection({
      ...baseState,
      selectedRows: [],
      selectedColumns: ['note', 'id'],
    });
    // Preserves displayColumns order, not selection order.
    expect(out.columns).toEqual(['id', 'note']);
    expect(out.rowIndices).toEqual([2, 0, 1]);
  });

  it('restricts to selected rows in view order when only rows are selected', () => {
    const out = resolveCopySelection({
      ...baseState,
      selectedRows: [1, 0],
      selectedColumns: [],
    });
    expect(out.columns).toEqual(['id', 'name', 'note']);
    // sortedRowIndices = [2, 0, 1] → global 0 is position 1, global 1 is position 2.
    expect(out.rowIndices).toEqual([0, 1]);
  });

  it('respects both row + column selection at once', () => {
    const out = resolveCopySelection({
      ...baseState,
      selectedRows: [2],
      selectedColumns: ['note'],
    });
    expect(out.columns).toEqual(['note']);
    expect(out.rowIndices).toEqual([2]);
  });
});

describe('shouldCopySingleCell', () => {
  it('true when only a single cell is focused (no selection)', () => {
    expect(
      shouldCopySingleCell({
        focusedRowIdx: 0,
        focusedColPos: 1,
        selectedRows: [],
        selectedColumns: [],
      })
    ).toBe(true);
  });

  it('false when any rows are selected', () => {
    expect(
      shouldCopySingleCell({
        focusedRowIdx: 0,
        focusedColPos: 1,
        selectedRows: [0],
        selectedColumns: [],
      })
    ).toBe(false);
  });

  it('false when any columns are selected', () => {
    expect(
      shouldCopySingleCell({
        focusedRowIdx: 0,
        focusedColPos: 1,
        selectedRows: [],
        selectedColumns: ['id'],
      })
    ).toBe(false);
  });

  it('false when focused on the row-number gutter (colPos -1)', () => {
    expect(
      shouldCopySingleCell({
        focusedRowIdx: 0,
        focusedColPos: -1,
        selectedRows: [],
        selectedColumns: [],
      })
    ).toBe(false);
  });

  it('false when nothing is focused', () => {
    expect(
      shouldCopySingleCell({
        focusedRowIdx: null,
        focusedColPos: 0,
        selectedRows: [],
        selectedColumns: [],
      })
    ).toBe(false);
  });
});

describe('formatCellCopyValue', () => {
  it('renders null and undefined as empty string', () => {
    expect(formatCellCopyValue(null)).toBe('');
    expect(formatCellCopyValue(undefined)).toBe('');
  });

  it('stringifies numbers, booleans, and strings', () => {
    expect(formatCellCopyValue(0)).toBe('0');
    expect(formatCellCopyValue(false)).toBe('false');
    expect(formatCellCopyValue('hi')).toBe('hi');
  });
});
