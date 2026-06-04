import { describe, expect, it } from 'vitest';
import {
  TABLE_PAGE_SIZE,
  mergeTablePage,
  primaryKeyKey,
  rowPrimaryKey,
} from '@/features/table-view/lib/tableViewRows';

describe('TABLE_PAGE_SIZE', () => {
  it('is positive', () => {
    expect(TABLE_PAGE_SIZE).toBeGreaterThan(0);
  });
});

describe('primaryKeyKey', () => {
  it('produces a deterministic key regardless of insertion order', () => {
    expect(primaryKeyKey({ b: 2, a: 1 })).toBe(primaryKeyKey({ a: 1, b: 2 }));
  });

  it('encodes values into the key, so distinct values produce distinct keys', () => {
    expect(primaryKeyKey({ id: 1 })).not.toBe(primaryKeyKey({ id: 2 }));
  });

  it('handles empty pk', () => {
    expect(primaryKeyKey({})).toBe('{}');
  });

  it('keeps non-string values intact in the JSON encoding', () => {
    expect(primaryKeyKey({ id: 1, valid: true })).toBe('{"id":1,"valid":true}');
  });
});

describe('rowPrimaryKey', () => {
  it('picks PK columns from the row by name', () => {
    expect(rowPrimaryKey([1, 'a', 'b'], ['id', 'name', 'note'], ['id'])).toEqual({
      id: 1,
    });
  });

  it('skips PK names that are not in the columns list', () => {
    expect(
      rowPrimaryKey([1, 'a'], ['id', 'name'], ['id', 'unknown'])
    ).toEqual({ id: 1 });
  });

  it('supports composite primary keys, preserving the PK order', () => {
    expect(
      rowPrimaryKey([1, 'a', 2], ['x', 'y', 'z'], ['z', 'x'])
    ).toEqual({ z: 2, x: 1 });
  });
});

describe('mergeTablePage', () => {
  it('replaces previous rows when replace=true', () => {
    expect(mergeTablePage([[1], [2]], [[9]], true)).toEqual([[9]]);
  });

  it('appends to previous rows when replace=false', () => {
    expect(mergeTablePage([[1], [2]], [[3], [4]], false)).toEqual([
      [1],
      [2],
      [3],
      [4],
    ]);
  });

  it('does not mutate the previous array', () => {
    const prev = [[1]];
    const out = mergeTablePage(prev, [[2]], false);
    expect(prev).toEqual([[1]]);
    expect(out).not.toBe(prev);
  });
});
