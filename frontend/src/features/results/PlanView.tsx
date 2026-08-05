import { ChevronDown, ChevronRight, Code2, Copy, ListTree, TriangleAlert } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  availableMetrics,
  collectParentKeys,
  defaultMetric,
  flattenPlan,
  formatEstimateFactor,
  formatPlanCost,
  formatPlanMs,
  formatPlanRows,
  isEstimateOff,
  type PlanMetric,
  type PlanRow,
} from '@/features/results/lib/planTree';
import { api } from '@/shared/lib/api';
import { appToast, toastError } from '@/shared/lib/appToast';
import { cx } from '@/shared/lib/cx';
import type { PlanNode, QueryPlan } from '@/types';

interface Props {
  plan: QueryPlan;
}

const INDENT_REM = 1.077;

/** Fixed widths in header order: each row is its own grid, so only fixed tracks line up. */
const METRIC_COLUMNS: { metric: PlanMetric; width: string }[] = [
  { metric: 'rows', width: '10rem' },
  { metric: 'time', width: '10rem' },
  { metric: 'cost', width: '10rem' },
];

export const PlanView = memo(function PlanView({ plan }: Props) {
  const { t } = useTranslation();
  const metrics = useMemo(() => availableMetrics(plan), [plan]);
  const [metric, setMetric] = useState<PlanMetric | null>(() => defaultMetric(plan));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>('0');
  const [showRaw, setShowRaw] = useState(false);

  // A new plan can replace the old one in place.
  useEffect(() => {
    setMetric(defaultMetric(plan));
    setCollapsed(new Set());
    setSelectedKey('0');
    setShowRaw(false);
  }, [plan]);

  // Only the metrics the engine reported get a column, or the grid would be mostly blank.
  const columns = useMemo(() => METRIC_COLUMNS.filter((column) => metrics.includes(column.metric)), [metrics]);
  const gridColumns = useMemo(
    () => ['minmax(18rem, 1fr)', ...columns.map((column) => column.width)].join(' '),
    [columns],
  );
  const shown = useMemo(() => new Set(columns.map((column) => column.metric)), [columns]);

  const rows = useMemo(() => flattenPlan(plan, metric, collapsed), [plan, metric, collapsed]);
  const selected = useMemo(() => rows.find((row) => row.key === selectedKey), [rows, selectedKey]);
  const allCollapsed = useMemo(() => collectParentKeys(plan.nodes ?? []), [plan.nodes]);
  const isAllCollapsed = allCollapsed.length > 0 && allCollapsed.every((key) => collapsed.has(key));

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setCollapsed((prev) => (allCollapsed.every((key) => prev.has(key)) ? new Set() : new Set(allCollapsed)));
  }, [allCollapsed]);

  const treeRef = useRef<HTMLDivElement>(null);

  // One tab stop with a roving focus, so arrows walk the tree.
  const focusRow = useCallback((key: string) => {
    setSelectedKey(key);
    treeRef.current?.querySelector<HTMLElement>(`[data-plan-key="${key}"]`)?.focus();
  }, []);

  const onTreeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const index = rows.findIndex((row) => row.key === selectedKey);
      if (index < 0) return;
      const row = rows[index];
      switch (e.key) {
        case 'ArrowDown':
          if (index + 1 < rows.length) focusRow(rows[index + 1].key);
          break;
        case 'ArrowUp':
          if (index > 0) focusRow(rows[index - 1].key);
          break;
        case 'ArrowRight':
          if (!row.hasChildren) return;
          if (collapsed.has(row.key)) toggle(row.key);
          else if (index + 1 < rows.length) focusRow(rows[index + 1].key);
          break;
        case 'ArrowLeft':
          if (row.hasChildren && !collapsed.has(row.key)) {
            toggle(row.key);
            break;
          }
          if (row.depth > 0) focusRow(row.key.slice(0, row.key.lastIndexOf('.')));
          break;
        case 'Home':
          focusRow(rows[0].key);
          break;
        case 'End':
          focusRow(rows[rows.length - 1].key);
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [rows, selectedKey, collapsed, focusRow, toggle],
  );

  const copyRaw = useCallback(async () => {
    try {
      await api.copyToClipboard(plan.raw);
      appToast.success(t('toast.copiedClipboard'));
    } catch (e) {
      toastError(e, t('errors.copyFailed'));
    }
  }, [plan.raw, t]);

  return (
    <div className="plan-view">
      <div className="plan-toolbar">
        <span className={cx('plan-badge', plan.analyzed && 'plan-badge-analyzed')}>
          {plan.analyzed ? t('results.planAnalyzed') : t('results.planEstimated')}
        </span>
        <PlanSummary plan={plan} />
        <div className="plan-toolbar-spacer" />
        {metrics.length > 1 && !showRaw && (
          <div className="plan-metric-switch" role="group" aria-label={t('results.planHeatBy')}>
            {metrics.map((option) => (
              <button
                key={option}
                type="button"
                className={cx('plan-metric-btn', option === metric && 'active')}
                onClick={() => setMetric(option)}
                data-tooltip={t('results.planHeatByMetric', { metric: t(`results.planMetric.${option}`) })}
              >
                {t(`results.planMetric.${option}`)}
              </button>
            ))}
          </div>
        )}
        {!showRaw && allCollapsed.length > 0 && (
          <button
            type="button"
            className="btn btn-sm plan-icon-btn"
            onClick={toggleAll}
            aria-label={isAllCollapsed ? t('results.planExpandAll') : t('results.planCollapseAll')}
            data-tooltip={isAllCollapsed ? t('results.planExpandAll') : t('results.planCollapseAll')}
          >
            <ListTree className="icon-sm" />
          </button>
        )}
        <button
          type="button"
          className={cx('btn btn-sm plan-icon-btn', showRaw && 'active')}
          onClick={() => setShowRaw((v) => !v)}
          aria-label={t('results.planRaw')}
          data-tooltip={t('results.planRaw')}
          aria-pressed={showRaw}
        >
          <Code2 className="icon-sm" />
        </button>
        <button
          type="button"
          className="btn btn-sm plan-icon-btn"
          onClick={() => void copyRaw()}
          aria-label={t('results.planCopy')}
          data-tooltip={t('results.planCopy')}
        >
          <Copy className="icon-sm" />
        </button>
      </div>

      {plan.notes && plan.notes.length > 0 && (
        <div className="plan-notes">
          {plan.notes.map((note) => (
            <span key={note} className="plan-note">
              {t(`results.planNote.${note}`, { defaultValue: note })}
            </span>
          ))}
        </div>
      )}

      {showRaw ? (
        <pre className="plan-raw">{plan.raw}</pre>
      ) : (
        <div className="plan-body">
          <div className="plan-tree-scroll">
            <div
              ref={treeRef}
              className="plan-tree"
              role="tree"
              aria-label={t('results.planTitle')}
              onKeyDown={onTreeKeyDown}
              style={{ '--plan-cols': gridColumns } as React.CSSProperties}
            >
              <div className="plan-head">
                <span className="plan-head-node">{t('results.planNode')}</span>
                {shown.has('rows') && <span className="plan-head-metric">{t('results.planColRows')}</span>}
                {shown.has('time') && <span className="plan-head-metric">{t('results.planColTime')}</span>}
                {shown.has('cost') && <span className="plan-head-metric">{t('results.planColCost')}</span>}
              </div>
              {rows.map((row) => (
                <PlanTreeRow
                  key={row.key}
                  row={row}
                  shown={shown}
                  selected={row.key === selectedKey}
                  collapsed={collapsed.has(row.key)}
                  onSelect={setSelectedKey}
                  onToggle={toggle}
                />
              ))}
            </div>
          </div>
          {selected && <PlanDetails row={selected} />}
        </div>
      )}
    </div>
  );
});

function PlanSummary({ plan }: { plan: QueryPlan }) {
  const { t } = useTranslation();
  return (
    <div className="plan-summary">
      {plan.planningMs != null && (
        <span className="plan-stat">
          <span className="plan-stat-label">{t('results.planPlanning')}</span>
          {formatPlanMs(plan.planningMs)}
        </span>
      )}
      {plan.executionMs != null && (
        <span className="plan-stat">
          <span className="plan-stat-label">{t('results.planExecution')}</span>
          {formatPlanMs(plan.executionMs)}
        </span>
      )}
      {plan.totalCost != null && (
        <span className="plan-stat">
          <span className="plan-stat-label">{t('results.planTotalCost')}</span>
          {formatPlanCost(plan.totalCost)}
        </span>
      )}
    </div>
  );
}

interface PlanTreeRowProps {
  row: PlanRow;
  /** Metric columns the plan carries; the others get no cell, matching the header. */
  shown: Set<PlanMetric>;
  selected: boolean;
  collapsed: boolean;
  onSelect: (key: string) => void;
  onToggle: (key: string) => void;
}

const PlanTreeRow = memo(function PlanTreeRow({
  row,
  shown,
  selected,
  collapsed,
  onSelect,
  onToggle,
}: PlanTreeRowProps) {
  const { t } = useTranslation();
  const { node } = row;
  const estimateOff = isEstimateOff(row.estimateFactor, node.neverRun);
  const rows = node.rowsActual ?? node.rowsPlanned;

  return (
    <div
      className={cx(
        'plan-row',
        selected && 'plan-row-selected',
        row.hottest && 'plan-row-hottest',
        node.neverRun && 'plan-row-never',
      )}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? !collapsed : undefined}
      data-plan-key={row.key}
      tabIndex={selected ? 0 : -1}
      style={{ '--plan-heat': row.heat } as React.CSSProperties}
    >
      <span className="plan-heat" aria-hidden="true" />
      <span className="plan-row-main" style={{ paddingLeft: `${row.depth * INDENT_REM}rem` }}>
        {row.hasChildren ? (
          <button
            type="button"
            className="plan-twisty"
            onClick={() => onToggle(row.key)}
            aria-label={collapsed ? t('results.planExpandNode') : t('results.planCollapseNode')}
          >
            {collapsed ? <ChevronRight className="icon-xs" /> : <ChevronDown className="icon-xs" />}
          </button>
        ) : (
          <span className="plan-twisty-spacer" aria-hidden="true" />
        )}
        <button type="button" className="plan-node-btn" onClick={() => onSelect(row.key)}>
          <span className="plan-node-label">{node.label}</span>
          {node.relation && <span className="plan-node-relation">{node.relation}</span>}
          {node.index && <span className="plan-node-index">{node.index}</span>}
          {node.neverRun && <span className="plan-chip">{t('results.planNeverRun')}</span>}
          {estimateOff && (
            <span className="plan-chip plan-chip-warn" data-tooltip={t('results.planEstimateOffHint')}>
              <TriangleAlert className="icon-2xs" />
              {formatEstimateFactor(row.estimateFactor)}
            </span>
          )}
          {node.detail && <span className="plan-node-detail">{node.detail}</span>}
        </button>
      </span>
      {shown.has('rows') && (
        <span className="plan-cell" title={planRowsTitle(t, node)}>
          {formatPlanRows(rows)}
          {node.rowsActual != null && node.rowsPlanned != null && (
            <span className="plan-cell-sub">{formatPlanRows(node.rowsPlanned)}</span>
          )}
        </span>
      )}
      {shown.has('time') && (
        <span className="plan-cell">
          {formatPlanMs(node.selfTimeMs)}
          {node.timeMs != null && node.selfTimeMs != null && node.timeMs !== node.selfTimeMs && (
            <span className="plan-cell-sub">{formatPlanMs(node.timeMs)}</span>
          )}
        </span>
      )}
      {shown.has('cost') && (
        <span className="plan-cell">
          {formatPlanCost(node.costSelf)}
          {node.costTotal != null && node.costSelf != null && node.costTotal !== node.costSelf && (
            <span className="plan-cell-sub">{formatPlanCost(node.costTotal)}</span>
          )}
        </span>
      )}
    </div>
  );
});

function planRowsTitle(t: (key: string, opts?: Record<string, unknown>) => string, node: PlanNode): string {
  if (node.rowsActual != null && node.rowsPlanned != null) {
    return t('results.planRowsTitle', {
      actual: formatPlanRows(node.rowsActual),
      planned: formatPlanRows(node.rowsPlanned),
    });
  }
  return '';
}

function PlanDetails({ row }: { row: PlanRow }) {
  const { t } = useTranslation();
  const { node } = row;
  const stats: { label: string; value: string }[] = [];
  if (node.rowsActual != null)
    stats.push({ label: t('results.planRowsActual'), value: formatPlanRows(node.rowsActual) });
  if (node.rowsPlanned != null)
    stats.push({ label: t('results.planRowsPlanned'), value: formatPlanRows(node.rowsPlanned) });
  if (node.loops != null) stats.push({ label: t('results.planLoops'), value: formatPlanRows(node.loops) });
  if (node.selfTimeMs != null) stats.push({ label: t('results.planSelfTime'), value: formatPlanMs(node.selfTimeMs) });
  if (node.timeMs != null) stats.push({ label: t('results.planTotalTime'), value: formatPlanMs(node.timeMs) });
  if (node.costSelf != null) stats.push({ label: t('results.planSelfCost'), value: formatPlanCost(node.costSelf) });
  if (node.costTotal != null) stats.push({ label: t('results.planTotalCost'), value: formatPlanCost(node.costTotal) });

  return (
    <div className="plan-details">
      <div className="plan-details-head">
        <span className="plan-details-title">{node.label}</span>
        {node.relation && <span className="plan-node-relation">{node.relation}</span>}
        {node.index && <span className="plan-node-index">{node.index}</span>}
      </div>
      {node.detail && <div className="plan-details-detail">{node.detail}</div>}
      {stats.length > 0 && (
        <dl className="plan-details-grid">
          {stats.map((stat) => (
            <div key={stat.label} className="plan-details-entry">
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {node.fields && node.fields.length > 0 && (
        <dl className="plan-details-grid plan-details-fields">
          {node.fields.map((field) => (
            <div key={field.key} className="plan-details-entry">
              <dt>{field.key}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
