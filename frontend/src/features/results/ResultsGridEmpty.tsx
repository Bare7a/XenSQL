import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/shared/components/ErrorState';
import type { QueryResult } from '@/types';

interface ResultsGridEmptyProps {
  error: string | null;
  result: QueryResult | null;
}

export function ResultsGridEmpty({ error, result }: ResultsGridEmptyProps) {
  const { t } = useTranslation();

  if (error) {
    return (
      <div className="results-grid">
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="results-grid">
      <div className="results-header">
        <span>{result?.message || t('results.noResults')}</span>
        {result && (
          <span>
            {t('results.metaRowsShort', {
              ms: result.durationMs,
              count: result.affectedRows || result.rowCount,
            })}
          </span>
        )}
      </div>
      <div className="empty-state">{result?.message || t('results.runQueryHint')}</div>
    </div>
  );
}
