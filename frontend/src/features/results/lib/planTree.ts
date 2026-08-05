import type { PlanNode, QueryPlan } from '@/types';

export type PlanMetric = 'time' | 'cost' | 'rows';

export const PLAN_METRICS: PlanMetric[] = ['time', 'cost', 'rows'];

/** An estimate off by this much means the planner picked blind. */
export const PLAN_ESTIMATE_WARN_FACTOR = 10;

export interface PlanRow {
  node: PlanNode;
  /** Path key ("0.1.2"), stable across renders; keys both React and the collapse set. */
  key: string;
  depth: number;
  hasChildren: boolean;
  /** 0..1 share of the plan's largest self-metric. */
  heat: number;
  hottest: boolean;
  estimateFactor?: number;
}

/** The node's own share, so a parent isn't hot merely because its children are. */
function heatValue(node: PlanNode, metric: PlanMetric): number | undefined {
  const value =
    metric === 'time' ? node.selfTimeMs : metric === 'cost' ? node.costSelf : (node.rowsActual ?? node.rowsPlanned);
  return value == null ? undefined : value;
}

function hasMetric(nodes: PlanNode[], metric: PlanMetric): boolean {
  return nodes.some((node) => heatValue(node, metric) != null || hasMetric(node.children ?? [], metric));
}

/** SQLite reports no metrics; EXPLAIN without ANALYZE reports no timings. */
export function availableMetrics(plan: QueryPlan): PlanMetric[] {
  return PLAN_METRICS.filter((metric) => hasMetric(plan.nodes ?? [], metric));
}

export function defaultMetric(plan: QueryPlan): PlanMetric | null {
  return availableMetrics(plan)[0] ?? null;
}

function maxHeat(nodes: PlanNode[], metric: PlanMetric): number {
  let max = 0;
  for (const node of nodes) {
    const value = heatValue(node, metric);
    if (value != null && value > max) max = value;
    max = Math.max(max, maxHeat(node.children ?? [], metric));
  }
  return max;
}

export function estimateFactor(node: PlanNode): number | undefined {
  const { rowsActual, rowsPlanned } = node;
  if (rowsActual == null || rowsPlanned == null || rowsPlanned <= 0) return undefined;
  return rowsActual / rowsPlanned;
}

/** A node the executor never reached produced no rows by definition, so its factor says nothing. */
export function isEstimateOff(factor: number | undefined, neverRun = false): boolean {
  if (factor == null || neverRun) return false;
  return factor >= PLAN_ESTIMATE_WARN_FACTOR || factor <= 1 / PLAN_ESTIMATE_WARN_FACTOR;
}

export function collectKeys(nodes: PlanNode[], prefix = ''): string[] {
  const keys: string[] = [];
  nodes.forEach((node, i) => {
    const key = prefix ? `${prefix}.${i}` : String(i);
    keys.push(key);
    keys.push(...collectKeys(node.children ?? [], key));
  });
  return keys;
}

/** Only the keys that can be collapsed. */
export function collectParentKeys(nodes: PlanNode[], prefix = ''): string[] {
  const keys: string[] = [];
  nodes.forEach((node, i) => {
    const key = prefix ? `${prefix}.${i}` : String(i);
    const children = node.children ?? [];
    if (children.length > 0) {
      keys.push(key);
      keys.push(...collectParentKeys(children, key));
    }
  });
  return keys;
}

/** The visible rows. Heat scales against the whole plan, so collapsing never recolours a row. */
export function flattenPlan(plan: QueryPlan, metric: PlanMetric | null, collapsed: Set<string>): PlanRow[] {
  const nodes = plan.nodes ?? [];
  const max = metric ? maxHeat(nodes, metric) : 0;
  const rows: PlanRow[] = [];

  const walk = (siblings: PlanNode[], depth: number, prefix: string) => {
    siblings.forEach((node, i) => {
      const key = prefix ? `${prefix}.${i}` : String(i);
      const children = node.children ?? [];
      const value = metric ? heatValue(node, metric) : undefined;
      rows.push({
        node,
        key,
        depth,
        hasChildren: children.length > 0,
        heat: value != null && max > 0 ? value / max : 0,
        hottest: value != null && max > 0 && value === max,
        estimateFactor: estimateFactor(node),
      });
      if (children.length > 0 && !collapsed.has(key)) {
        walk(children, depth + 1, key);
      }
    });
  };
  walk(nodes, 0, '');
  return rows;
}

/** Sub-millisecond timings stay readable; slow nodes switch to seconds. */
export function formatPlanMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms >= 1000) return `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`;
  if (ms >= 1) return `${ms.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms`;
  if (ms === 0) return '0 ms';
  return `${ms.toLocaleString(undefined, { maximumFractionDigits: 3 })} ms`;
}

/** Whole rows stay exact - a bad estimate is the point of the column. */
export function formatPlanRows(rows: number | null | undefined): string {
  if (rows == null || !Number.isFinite(rows)) return '';
  if (Number.isInteger(rows)) return rows.toLocaleString();
  return rows.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function formatPlanCost(cost: number | null | undefined): string {
  if (cost == null || !Number.isFinite(cost)) return '';
  if (cost >= 1000) return cost.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return cost.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** How far off the estimate was, as a multiplier ("12x", "0.1x"). */
export function formatEstimateFactor(factor: number | undefined): string {
  if (factor == null || !Number.isFinite(factor)) return '';
  if (factor >= 10) return `${factor.toLocaleString(undefined, { maximumFractionDigits: 0 })}x`;
  return `${factor.toLocaleString(undefined, { maximumFractionDigits: factor < 1 ? 2 : 1 })}x`;
}
