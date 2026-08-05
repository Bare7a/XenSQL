import { describe, expect, it } from 'vitest';
import {
  availableMetrics,
  collectParentKeys,
  defaultMetric,
  estimateFactor,
  flattenPlan,
  formatEstimateFactor,
  formatPlanCost,
  formatPlanMs,
  formatPlanRows,
  isEstimateOff,
} from '@/features/results/lib/planTree';
import type { PlanNode, QueryPlan } from '@/types';

function plan(nodes: PlanNode[], overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    driver: 'postgres',
    statement: 'SELECT 1',
    explainSql: 'EXPLAIN (FORMAT JSON) SELECT 1',
    analyzed: true,
    nodes,
    durationMs: 3,
    raw: '[]',
    ...overrides,
  };
}

// A three-node plan whose middle child is by far the most expensive.
const measured = plan([
  {
    label: 'Nested Loop',
    selfTimeMs: 2,
    timeMs: 12,
    costSelf: 5,
    costTotal: 40,
    rowsActual: 9,
    rowsPlanned: 10,
    children: [
      { label: 'Seq Scan', relation: 'orders', selfTimeMs: 8, timeMs: 8, costSelf: 30, costTotal: 30, rowsActual: 9 },
      {
        label: 'Index Scan',
        relation: 'customers',
        selfTimeMs: 2,
        timeMs: 2,
        costSelf: 5,
        costTotal: 5,
        rowsActual: 9,
      },
    ],
  },
]);

describe('availableMetrics', () => {
  it('offers every metric the engine reported', () => {
    expect(availableMetrics(measured)).toEqual(['time', 'cost', 'rows']);
  });

  it('drops timings when the plan was never measured', () => {
    const estimated = plan([{ label: 'Seq Scan', costSelf: 3, rowsPlanned: 100 }], { analyzed: false });
    expect(availableMetrics(estimated)).toEqual(['cost', 'rows']);
    expect(defaultMetric(estimated)).toBe('cost');
  });

  it('offers nothing for a plan without metrics, as SQLite reports', () => {
    const shapeOnly = plan([{ label: 'SCAN', relation: 'users', children: [{ label: 'SCAN', relation: 'x' }] }]);
    expect(availableMetrics(shapeOnly)).toEqual([]);
    expect(defaultMetric(shapeOnly)).toBeNull();
  });

  it('finds a metric that only a nested node carries', () => {
    const nested = plan([{ label: 'Result', children: [{ label: 'Seq Scan', costSelf: 1 }] }]);
    expect(availableMetrics(nested)).toEqual(['cost']);
  });
});

describe('flattenPlan', () => {
  it('walks the tree depth-first with keys that encode the path', () => {
    const rows = flattenPlan(measured, 'time', new Set());
    expect(rows.map((row) => row.key)).toEqual(['0', '0.0', '0.1']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 1]);
    expect(rows.map((row) => row.node.label)).toEqual(['Nested Loop', 'Seq Scan', 'Index Scan']);
  });

  it('scales heat against the largest own-metric and marks the hottest node', () => {
    const rows = flattenPlan(measured, 'time', new Set());
    // Self time, not total: the root is cheap even though its subtree is slow.
    expect(rows.map((row) => row.heat)).toEqual([2 / 8, 1, 2 / 8]);
    expect(rows.filter((row) => row.hottest).map((row) => row.node.label)).toEqual(['Seq Scan']);
  });

  it('re-ranks when the metric changes', () => {
    const byCost = flattenPlan(measured, 'cost', new Set());
    expect(byCost.map((row) => row.heat)).toEqual([5 / 30, 1, 5 / 30]);
  });

  it('hides the children of a collapsed node but keeps the heat scale', () => {
    const rows = flattenPlan(measured, 'time', new Set(['0']));
    expect(rows.map((row) => row.key)).toEqual(['0']);
    // Still scaled against the hidden Seq Scan's 8ms, so expanding never recolours the row.
    expect(rows[0].heat).toBe(2 / 8);
    expect(rows[0].hasChildren).toBe(true);
  });

  it('leaves every row cold when the engine reported no metrics', () => {
    const shapeOnly = plan([{ label: 'SCAN', children: [{ label: 'SEARCH' }] }]);
    const rows = flattenPlan(shapeOnly, null, new Set());
    expect(rows.map((row) => row.heat)).toEqual([0, 0]);
    expect(rows.some((row) => row.hottest)).toBe(false);
  });

  it('falls back to estimated rows when nothing was measured', () => {
    const estimated = plan(
      [
        { label: 'Seq Scan', rowsPlanned: 50 },
        { label: 'Index Scan', rowsPlanned: 100 },
      ],
      {
        analyzed: false,
      },
    );
    expect(flattenPlan(estimated, 'rows', new Set()).map((row) => row.heat)).toEqual([0.5, 1]);
  });

  it('handles a plan with no nodes', () => {
    expect(flattenPlan(plan([]), 'time', new Set())).toEqual([]);
  });
});

describe('collectParentKeys', () => {
  it('returns only the keys that can be collapsed', () => {
    expect(collectParentKeys(measured.nodes)).toEqual(['0']);
  });

  it('descends into nested parents', () => {
    const nodes: PlanNode[] = [{ label: 'a', children: [{ label: 'b', children: [{ label: 'c' }] }] }];
    expect(collectParentKeys(nodes)).toEqual(['0', '0.0']);
  });
});

describe('estimateFactor', () => {
  it('is the ratio of measured to estimated rows', () => {
    expect(estimateFactor({ label: 'n', rowsActual: 500, rowsPlanned: 10 })).toBe(50);
  });

  it('is undefined unless both counts are known', () => {
    expect(estimateFactor({ label: 'n', rowsActual: 500 })).toBeUndefined();
    expect(estimateFactor({ label: 'n', rowsPlanned: 10 })).toBeUndefined();
    // A zero estimate would divide by zero; Postgres reports 0 for an empty partition.
    expect(estimateFactor({ label: 'n', rowsActual: 5, rowsPlanned: 0 })).toBeUndefined();
  });

  it('flags estimates off by ten times in either direction', () => {
    expect(isEstimateOff(1)).toBe(false);
    expect(isEstimateOff(9)).toBe(false);
    expect(isEstimateOff(10)).toBe(true);
    expect(isEstimateOff(0.1)).toBe(true);
    expect(isEstimateOff(0.5)).toBe(false);
    expect(isEstimateOff(undefined)).toBe(false);
  });

  it('says nothing about a node the executor never reached', () => {
    // 0 measured against 1 estimated is a factor of 0, but the node simply never ran.
    expect(isEstimateOff(0, true)).toBe(false);
    expect(isEstimateOff(0, false)).toBe(true);
  });
});

describe('formatting', () => {
  it('keeps sub-millisecond timings legible and switches to seconds when slow', () => {
    expect(formatPlanMs(0)).toBe('0 ms');
    expect(formatPlanMs(0.0216)).toBe('0.022 ms');
    expect(formatPlanMs(4.27)).toBe('4.3 ms');
    expect(formatPlanMs(2500)).toBe('2.5 s');
    expect(formatPlanMs(null)).toBe('');
    expect(formatPlanMs(undefined)).toBe('');
  });

  it('renders whole rows exactly and averages to one decimal', () => {
    expect(formatPlanRows(0)).toBe('0');
    expect(formatPlanRows(1234)).toBe('1,234');
    expect(formatPlanRows(2.25)).toBe('2.3');
    expect(formatPlanRows(null)).toBe('');
  });

  it('renders cost with cents up to a thousand', () => {
    expect(formatPlanCost(18.1)).toBe('18.1');
    expect(formatPlanCost(0.295)).toBe('0.3');
    expect(formatPlanCost(12345.6)).toBe('12,346');
    expect(formatPlanCost(undefined)).toBe('');
  });

  it('renders how far off an estimate was as a multiplier', () => {
    expect(formatEstimateFactor(50)).toBe('50x');
    expect(formatEstimateFactor(2.5)).toBe('2.5x');
    expect(formatEstimateFactor(0.05)).toBe('0.05x');
    expect(formatEstimateFactor(undefined)).toBe('');
  });
});
