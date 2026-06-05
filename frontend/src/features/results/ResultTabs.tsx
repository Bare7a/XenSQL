import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ResultSet } from '@/types';

interface Props {
  results: ResultSet[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

// Result-set switcher shown when a run produced more than one result set (a multi-statement script,
// or a stored procedure returning several sets). Hidden for the common single-result case.
export function ResultTabs({ results, activeIndex, onSelect }: Props) {
  const { t } = useTranslation();
  if (results.length <= 1) return null;
  return (
    <div className="result-tabs" role="tablist">
      {results.map((rs, i) => {
        const isActive = i === activeIndex;
        const count = rs.error
          ? null
          : rs.result?.columns?.length
            ? rs.result.rowCount
            : (rs.result?.affectedRows ?? 0);
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
              {t('results.resultLabel', { n: i + 1 })}
              {!rs.error && count != null ? (
                <span className="result-tab-count">{count.toLocaleString()}</span>
              ) : null}
            </span>
            {rs.error ? (
              <CircleAlert className="icon-xs" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
