import { describe, expect, it } from 'vitest';
import { compareCellValues } from '@/features/results/hooks/useGridSort';

const sortWith = (values: unknown[]) => [...values].sort((a, b) => compareCellValues(a, b));

describe('compareCellValues', () => {
  it('orders integers by value, including negatives', () => {
    // Regression: String().localeCompare(numeric) ignored the minus sign and scrambled negatives.
    expect(sortWith([5, -3, -10, 2, -1, 0])).toEqual([-10, -3, -1, 0, 2, 5]);
  });

  it('orders floats by value', () => {
    expect(sortWith([1.5, -2.5, 10, -10, 2])).toEqual([-10, -2.5, 1.5, 2, 10]);
  });

  it('orders booleans false before true', () => {
    expect(compareCellValues(false, true)).toBeLessThan(0);
    expect(compareCellValues(true, false)).toBeGreaterThan(0);
    expect(compareCellValues(true, true)).toBe(0);
  });

  it('still uses natural (numeric-aware) ordering for text', () => {
    expect(sortWith(['item10', 'item2', 'item1'])).toEqual(['item1', 'item2', 'item10']);
  });

  it('sorts NaN to the end instead of treating it as equal to everything', () => {
    // Regression: NaN < x and NaN > x are both false, so NaN used to compare equal to every number.
    expect(sortWith([3, NaN, 1, 2])).toEqual([1, 2, 3, NaN]);
    expect(compareCellValues(NaN, NaN)).toBe(0);
  });
});
