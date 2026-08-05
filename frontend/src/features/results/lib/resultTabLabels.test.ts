import { describe, expect, it } from 'vitest';
import { resultTabLabels } from '@/features/results/lib/resultTabLabels';
import type { QueryPlan, QueryResult, ResultSet } from '@/types';

const grid = (rowCount: number): QueryResult => ({
  columns: ['id'],
  columnTypes: ['INTEGER'],
  rows: [],
  rowCount,
  affectedRows: 0,
  durationMs: 1,
});

const plan = (): QueryPlan => ({
  driver: 'postgres',
  statement: 'SELECT 1',
  explainSql: 'EXPLAIN (FORMAT JSON) SELECT 1',
  analyzed: false,
  nodes: [{ label: 'Seq Scan' }],
  durationMs: 1,
  raw: '[]',
});

const set = (over: Partial<ResultSet>): ResultSet => ({ result: null, error: null, ...over });

describe('resultTabLabels', () => {
  it('numbers grids and plans in separate sequences', () => {
    const labels = resultTabLabels([
      set({ result: grid(5) }),
      set({ plan: plan() }),
      set({ result: grid(2) }),
      set({ plan: plan() }),
    ]);
    expect(labels).toEqual([
      { key: 'results.resultLabel', n: 1, count: 5 },
      { key: 'results.planLabel', n: 1, count: null },
      { key: 'results.resultLabel', n: 2, count: 2 },
      { key: 'results.planLabel', n: 2, count: null },
    ]);
  });

  it('counts affected rows for a statement with no columns', () => {
    const updated: QueryResult = { ...grid(0), columns: [], columnTypes: [], affectedRows: 7 };
    expect(resultTabLabels([set({ result: updated })])).toEqual([{ key: 'results.resultLabel', n: 1, count: 7 }]);
  });

  it('shows no count for a failed statement', () => {
    expect(resultTabLabels([set({ error: 'boom' })])).toEqual([{ key: 'results.resultLabel', n: 1, count: null }]);
  });

  // A failed EXPLAIN has no plan, so it counts as a grid - that's where its error renders.
  it('treats a failed explain as a grid', () => {
    const labels = resultTabLabels([set({ plan: plan() }), set({ error: 'syntax error' })]);
    expect(labels.map((l) => l.key)).toEqual(['results.planLabel', 'results.resultLabel']);
  });

  it('handles an empty run', () => {
    expect(resultTabLabels([])).toEqual([]);
  });
});
