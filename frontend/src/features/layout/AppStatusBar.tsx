import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Lock } from 'lucide-react';
import { cx } from '@/shared/lib/cx';
import { tooltipProps } from '@/shared/lib/tooltip';
import type { ConnectionConfig, ConnectionStatus, EditorTab, QueryResult } from '@/types';

interface AppStatusBarProps {
  activeConn: ConnectionConfig | undefined;
  activeTab: EditorTab | undefined;
  connectedIds: Record<string, boolean>;
  connStatus: ConnectionStatus | null;
  activeResult: QueryResult | null;
  activeResultError: string | null;
  isRunning: boolean;
}

function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef(0);
  useEffect(() => {
    if (!running) return;
    startRef.current = performance.now();
    setSeconds(0);
    const id = window.setInterval(() => {
      setSeconds((performance.now() - startRef.current) / 1000);
    }, 100);
    return () => window.clearInterval(id);
  }, [running]);
  return running ? seconds : 0;
}

export function AppStatusBar({
  activeConn,
  activeTab,
  connectedIds,
  connStatus,
  activeResult,
  activeResultError,
  isRunning,
}: AppStatusBarProps) {
  const { t } = useTranslation();
  const activeReadOnly = !!activeConn?.readOnly;
  const seconds = useElapsedSeconds(isRunning).toFixed(1);

  let rightSideText: string;
  if (isRunning) {
    rightSideText =
      activeResult?.streaming && (activeResult?.rowCount ?? 0) > 0
        ? t('app.statusStreaming', { count: activeResult.rowCount, seconds })
        : t('app.statusRunning', { seconds });
  } else if (activeResultError) {
    rightSideText = activeResultError;
  } else if (activeResult) {
    rightSideText =
      (activeResult.columns?.length ?? 0) > 0
        ? t('app.statusRows', { count: activeResult.rowCount, ms: activeResult.durationMs })
        : t('app.statusAffected', { count: activeResult.affectedRows, ms: activeResult.durationMs });
  } else if (connStatus?.connected) {
    rightSideText = t('app.statusConnectedTo', { database: connStatus.database });
  } else {
    rightSideText = t('app.statusReady');
  }

  const showingError = !!activeResultError && !isRunning;
  const rightSideClass = showingError ? 'error' : !isRunning && activeResult ? 'success' : '';

  // Schema suffix omitted when equal to database (MySQL/SQLite where they coincide).
  let sessionText = '';
  if (connStatus?.connected) {
    const origin = [connStatus.user, connStatus.host].filter(Boolean).join('@');
    sessionText = origin ? `${origin}/${connStatus.database}` : connStatus.database;
    if (connStatus.schema && connStatus.schema !== connStatus.database) {
      sessionText += ` (${connStatus.schema})`;
    }
  }

  return (
    <div className="status-bar">
      <div className="status-bar-info">
        {activeConn ? (
          <>
            <span
              className="connection-dot"
              style={{ background: connectedIds[activeConn.id] ? 'var(--success)' : activeConn.color }}
              aria-hidden
            />
            <span className="status-bar-conn-label" data-tooltip={sessionText}>{activeConn.name} ({activeConn.driver})</span>
            {activeReadOnly && (
              <span className="read-only-badge" data-tooltip={t('tooltip.readOnlyConnection')}>
                <Lock className="icon-2xs" strokeWidth={2.25} />
                {t('app.readOnly')}
              </span>
            )}
            {activeTab && !connectedIds[activeTab.connectionId] && (<span className="app-status-warning">{t('app.statusNotConnected')}</span>)}
          </>
        ) : (
          <span className="status-bar-conn-label">{t('app.statusNoConnection')}</span>
        )}
      </div>
      <div
        className={cx('status-bar-status', rightSideClass)}
        role="status"
        aria-live="polite"
        {...tooltipProps(showingError ? activeResultError : undefined)}
      >
        {showingError && (<CircleAlert className="icon-xs status-bar-status-icon" aria-hidden />)}
        <span className="status-bar-status-text">{rightSideText}</span>
      </div>
    </div>
  );
}
