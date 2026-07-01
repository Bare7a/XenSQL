import { BookmarkPlus, Database, Globe, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@/shared/components/ContextMenu';
import { useContextMenu } from '@/shared/hooks/useContextMenu';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { rowActivateKeyDown, useListKeyboardNav } from '@/shared/hooks/useListKeyboardNav';
import { api } from '@/shared/lib/api';
import { appAlert, appConfirm, appError, appPrompt } from '@/shared/lib/appDialog';
import { appToast } from '@/shared/lib/appToast';
import { formatRelativeTime, type TimeBucket, timeBucket } from '@/shared/lib/relativeTime';
import { refreshSavedQueries } from '@/shared/lib/savedQueriesSync';
import { oneLinePreview } from '@/shared/lib/sqlPreview';
import { useAppStore } from '@/store/appStore';
import { useConnections, useResolvedConnectionId, useStoreActions } from '@/store/selectors';

interface HistoryPanelProps {
  onOpenQuery: (connId: string, sql?: string) => void;
}

const BUCKET_LABEL: Record<TimeBucket, string> = {
  today: 'sidebar.today',
  yesterday: 'sidebar.yesterday',
  last7: 'sidebar.last7days',
  last30: 'sidebar.last30days',
  older: 'sidebar.older',
};

export function HistoryPanel({ onOpenQuery }: HistoryPanelProps) {
  const { t, i18n } = useTranslation();
  const history = useAppStore((s) => s.history);
  const connections = useConnections();
  const resolvedConnId = useResolvedConnectionId();
  const { setHistory } = useStoreActions();

  const [filter, setFilter] = useState('');
  const [scope, setScope] = useState<'all' | 'connection'>('connection');
  const { menu, openMenu, closeMenu } = useContextMenu();

  const { onKeyDown } = useListKeyboardNav();

  const connectionById = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);

  const loadHistory = useCallback(
    async (connId?: string, scopeOverride?: 'all' | 'connection') => {
      const effectiveScope = scopeOverride ?? scope;
      const effectiveId = effectiveScope === 'all' ? '' : connId || '';
      try {
        const entries = await api.getQueryHistory(effectiveId, 200);
        setHistory(entries);
      } catch (err) {
        void appError(err, t('errors.generic'));
        setHistory([]);
      }
    },
    [scope, setHistory, t],
  );

  useEffect(() => {
    void loadHistory(resolvedConnId || undefined);
  }, [loadHistory, resolvedConnId]);

  const deleteHistoryEntry = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await api.deleteQueryHistoryEntry(id);
    await loadHistory(resolvedConnId || undefined);
  };

  const saveAsQuery = useCallback(
    async (connectionId: string, sql: string) => {
      const name = await appPrompt({
        title: t('dialog.saveQueryTitle'),
        description: t('dialog.saveQueryDescription'),
        label: t('dialog.queryNameLabel'),
        placeholder: t('dialog.queryNamePlaceholder'),
        confirmLabel: t('common.save'),
      });
      if (!name?.trim()) return;
      try {
        await api.saveSavedQuery({
          id: '',
          name: name.trim(),
          connectionId,
          sql,
          createdAt: '',
          updatedAt: '',
        });
        await refreshSavedQueries();
        appToast.success(t('toast.savedQuery'));
      } catch (err) {
        void appError(err, t('errors.saveQueryFailed'));
      }
    },
    [t],
  );

  const clearAllHistory = async () => {
    const all = scope === 'all';
    const connId = all ? '' : resolvedConnId || '';
    if (!all && !connId) {
      void appAlert({
        title: t('errors.noConnection'),
        description: t('dialog.noDatabaseDescription'),
      });
      return;
    }
    const conn = !all ? connections.find((c) => c.id === connId) : undefined;
    const ok = await appConfirm({
      title: t('dialog.clearHistoryTitle'),
      description:
        !all && conn
          ? t('dialog.clearHistoryDescription', { name: conn.name })
          : t('dialog.clearHistoryDescriptionGeneric'),
      confirmLabel: t('dialog.clearHistoryConfirm'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.clearQueryHistory(connId);
      await loadHistory(all ? undefined : connId, all ? 'all' : 'connection');
    } catch (err) {
      void appError(err, t('errors.generic'));
    }
  };

  const openRowMenu = useCallback(
    (e: React.MouseEvent, connectionId: string, sql: string, id: string) => {
      openMenu(e, [
        { label: t('sidebar.openQuery'), action: () => onOpenQuery(connectionId, sql) },
        { label: t('sidebar.saveAsQuery'), action: () => void saveAsQuery(connectionId, sql) },
        { label: t('sidebar.copySql'), action: () => void api.copyToClipboard(sql) },
        { label: '', action: () => {}, separator: true },
        { label: t('common.delete'), action: () => void deleteHistoryEntry(id) },
      ]);
    },
    [onOpenQuery, saveAsQuery, t],
  );

  const openFilterMenu = useCallback(
    (e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openMenu(
        {
          preventDefault: () => e.preventDefault(),
          stopPropagation: () => e.stopPropagation(),
          clientX: rect.left,
          clientY: rect.bottom + 4,
        } as React.MouseEvent,
        [
          {
            label: t('sidebar.scopeConnection'),
            icon: <Database className="icon-xs" />,
            active: scope === 'connection',
            action: () => {
              setScope('connection');
              void loadHistory(resolvedConnId || undefined, 'connection');
            },
          },
          {
            label: t('sidebar.scopeAll'),
            icon: <Globe className="icon-xs" />,
            active: scope === 'all',
            action: () => {
              setScope('all');
              void loadHistory(undefined, 'all');
            },
          },
          { label: '', action: () => {}, separator: true },
          {
            label: t('sidebar.clearAll'),
            icon: <Trash2 className="icon-xs" />,
            disabled: !(history?.length ?? 0),
            action: () => void clearAllHistory(),
          },
        ],
      );
    },
    [scope, history, resolvedConnId, loadHistory, t],
  );

  const debouncedFilter = useDebouncedValue(filter, 150);
  const filtered = useMemo(() => {
    const needle = debouncedFilter.trim().toLowerCase();
    if (!needle) return history ?? [];
    return (history ?? []).filter(
      (entry) => (entry.sql ?? '').toLowerCase().includes(needle) || (entry.error ?? '').toLowerCase().includes(needle),
    );
  }, [history, debouncedFilter]);

  let lastBucket: TimeBucket | null = null;

  return (
    <>
      <div className="sidebar-filter">
        <Search className="sidebar-filter-icon" aria-hidden />
        <input
          type="search"
          className="sidebar-filter-input"
          placeholder={t('sidebar.filterHistory')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm sidebar-filter-btn"
          data-testid="filter-menu"
          data-tooltip={t('tooltip.queryOptions')}
          onClick={openFilterMenu}
        >
          <SlidersHorizontal className="icon-xs" />
        </button>
      </div>

      {(history?.length ?? 0) === 0 ? (
        <div className="empty-state">
          <p>{t('sidebar.noQueryHistory')}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{t('sidebar.noMatches')}</p>
        </div>
      ) : (
        /* biome-ignore lint/a11y/noStaticElementInteractions: keyboard-navigation container (arrow/Home/End roving focus over its focusable rows via useListKeyboardNav); not itself an interactive control. */
        <div className="sidebar-list" onKeyDown={onKeyDown}>
          {filtered.map((entry, idx) => {
            const conn = connectionById.get(entry.connectionId);
            const bucket = timeBucket(entry.executedAt);
            const showHeader = bucket !== lastBucket;
            lastBucket = bucket;
            return (
              <div key={entry.id || `history-${idx}`}>
                {showHeader && <div className="sidebar-group-header">{t(BUCKET_LABEL[bucket])}</div>}
                <div
                  className="tree-item history-item history-entry"
                  role="button"
                  tabIndex={0}
                  data-nav-item
                  onClick={() => onOpenQuery(entry.connectionId, entry.sql)}
                  onKeyDown={rowActivateKeyDown}
                  onContextMenu={(e) => openRowMenu(e, entry.connectionId, entry.sql ?? '', entry.id)}
                >
                  <span
                    className={`history-status ${entry.success ? 'history-status--success' : 'history-status--danger'}`}
                    aria-hidden
                  />
                  <div className="flex-1 sidebar-entry-body">
                    <span className="sidebar-entry-sql">{oneLinePreview(entry.sql)}</span>
                    <span
                      className="sidebar-entry-meta"
                      data-tooltip={entry.executedAt ? new Date(entry.executedAt).toLocaleString() : undefined}
                    >
                      {entry.executedAt ? formatRelativeTime(entry.executedAt, i18n.language) : ''}
                      {' · '}
                      {entry.durationMs}ms
                      {conn && scope === 'all' ? ` · ${conn.name}` : ''}
                    </span>
                    {!entry.success && entry.error && (
                      <span className="sidebar-entry-error" data-tooltip={entry.error}>
                        {oneLinePreview(entry.error, 100)}
                      </span>
                    )}
                  </div>
                  <span className="history-item-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      data-tooltip={t('sidebar.saveAsQuery')}
                      onClick={(e) => {
                        e.stopPropagation();
                        void saveAsQuery(entry.connectionId, entry.sql ?? '');
                      }}
                    >
                      <BookmarkPlus className="icon-xs" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      data-nav-delete
                      data-tooltip={t('tooltip.deleteHistory')}
                      onClick={(e) => void deleteHistoryEntry(entry.id, e)}
                    >
                      <Trash2 className="icon-xs" />
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </>
  );
}
