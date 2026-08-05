// biome-ignore-all lint/suspicious/noArrayIndexKey: result-set tabs are positional, rebuilt wholesale on each run and never reordered, so the array index is the stable identity.
import { CircleAlert, Route } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { resultTabLabels } from '@/features/results/lib/resultTabLabels';
import { useHorizontalWheelScroll } from '@/shared/hooks/useHorizontalWheelScroll';
import type { ResultSet } from '@/types';

interface Props {
  results: ResultSet[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

// Shown when a run produced more than one output. Hidden for the common single-output case.
export function ResultTabs({ results, activeIndex, onSelect }: Props) {
  const { t } = useTranslation();
  const tabsRef = useRef<HTMLDivElement>(null);
  const showTabs = results.length > 1;
  useHorizontalWheelScroll(tabsRef, showTabs);
  const labels = useMemo(() => resultTabLabels(results), [results]);

  if (!showTabs) return null;
  return (
    <div ref={tabsRef} className="result-tabs" role="tablist">
      {results.map((rs, i) => {
        const isActive = i === activeIndex;
        const label = labels[i];
        const tooltip = rs.statement ? rs.statement.replace(/\s+/g, ' ').slice(0, 120) : undefined;
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`result-tab${isActive ? ' active' : ''}${rs.error ? ' error' : ''}`}
            onClick={() => onSelect(i)}
            data-tooltip={tooltip}
          >
            <span className="result-tab-text">
              {rs.plan ? <Route className="icon-xs result-tab-icon" /> : null}
              {t(label.key, { n: label.n })}
              {label.count != null ? <span className="result-tab-count">{label.count.toLocaleString()}</span> : null}
            </span>
            {rs.error ? <CircleAlert className="icon-xs" /> : null}
          </button>
        );
      })}
    </div>
  );
}
