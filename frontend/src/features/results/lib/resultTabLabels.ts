import type { ResultSet } from '@/types';

export interface ResultTabLabel {
  key: 'results.resultLabel' | 'results.planLabel';
  /** Ordinal within its own kind. */
  n: number;
  count: number | null;
}

/** Grids and plans count separately, so a mixed script reads "Result 1 · Plan 1 · Result 2". */
export function resultTabLabels(results: ResultSet[]): ResultTabLabel[] {
  let grids = 0;
  let plans = 0;
  return results.map((rs) => {
    if (rs.plan) {
      plans += 1;
      return { key: 'results.planLabel', n: plans, count: null };
    }
    grids += 1;
    const count = rs.error ? null : rs.result?.columns?.length ? rs.result.rowCount : (rs.result?.affectedRows ?? 0);
    return { key: 'results.resultLabel', n: grids, count };
  });
}
