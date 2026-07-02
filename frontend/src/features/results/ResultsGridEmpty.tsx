import { Crosshair } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/shared/components/ErrorState';
import { jumpToQueryError } from '@/shared/lib/jumpToError';
import type { QueryError, QueryResult } from '@/types';

interface ResultsGridEmptyProps {
  error: string | null;
  errorInfo?: QueryError | null;
  errorStatement?: string | null;
  result: QueryResult | null;
  allowJump?: boolean;
}

export function ResultsGridEmpty({ error, errorInfo, errorStatement, result, allowJump }: ResultsGridEmptyProps) {
  const { t } = useTranslation();

  if (error) {
    const info = errorInfo ?? null;
    const position = info?.position ?? 0;
    const canJump = !!allowJump && !!errorStatement && position > 0;
    return (
      <div className="results-grid">
        <ErrorState
          title={info?.code ? t('errors.queryFailed') : t('errors.generic')}
          message={info?.message || error}
          code={info?.code}
          hint={info?.hint}
          detail={info?.detail}
          action={
            canJump
              ? {
                  label: t('errors.jumpToError'),
                  icon: <Crosshair className="icon-xs" aria-hidden />,
                  onClick: () => jumpToQueryError(errorStatement as string, position, info?.message),
                }
              : undefined
          }
        />
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
