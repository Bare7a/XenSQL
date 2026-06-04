import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SavedQuery } from '@/types';
import { HistoryPanel } from '@/features/sidebar/HistoryPanel';
import { SavedQueriesPanel } from '@/features/sidebar/SavedQueriesPanel';
import { readStoredString, writeStoredString, STORAGE_KEYS } from '@/shared/lib/storageKeys';

type QueriesMode = 'saved' | 'history';

interface Props {
  onOpenQuery: (connId: string, sql?: string) => void;
  onOpenSavedQuery: (saved: SavedQuery) => void;
}

export function QueriesPanel({ onOpenQuery, onOpenSavedQuery }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<QueriesMode>(() =>
    readStoredString(STORAGE_KEYS.queriesMode, 'saved') === 'history' ? 'history' : 'saved'
  );
  const selectMode = (next: QueriesMode) => {
    setMode(next);
    writeStoredString(STORAGE_KEYS.queriesMode, next);
  };

  return (
    <>
      <div
        className="sidebar-toggle-group queries-mode"
        role="group"
        aria-label={t('sidebar.queries')}
      >
        <button
          type="button"
          className={`btn btn-sm ${mode === 'saved' ? 'active' : ''}`}
          onClick={() => selectMode('saved')}
        >
          {t('sidebar.saved')}
        </button>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'history' ? 'active' : ''}`}
          onClick={() => selectMode('history')}
        >
          {t('sidebar.recent')}
        </button>
      </div>

      {mode === 'saved' ? (
        <SavedQueriesPanel onOpenSavedQuery={onOpenSavedQuery} />
      ) : (
        <HistoryPanel onOpenQuery={onOpenQuery} />
      )}
    </>
  );
}
