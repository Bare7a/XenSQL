import {
  ArrowDownAZ,
  CalendarPlus,
  Clock,
  Database,
  Edit2,
  Globe,
  Pin,
  PinOff,
  Search,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RenameQueryDialog } from '@/features/editor/RenameQueryDialog';
import { ContextMenu } from '@/shared/components/ContextMenu';
import { useContextMenu } from '@/shared/hooks/useContextMenu';
import { rowActivateKeyDown, useListKeyboardNav } from '@/shared/hooks/useListKeyboardNav';
import { usePinnedQueries } from '@/shared/hooks/usePinnedQueries';
import { api } from '@/shared/lib/api';
import { appConfirm, appError } from '@/shared/lib/appDialog';
import { refreshSavedQueries } from '@/shared/lib/savedQueriesSync';
import { oneLinePreview } from '@/shared/lib/sqlPreview';
import { readStoredString, STORAGE_KEYS, writeStoredString } from '@/shared/lib/storageKeys';
import {
  useActiveTab,
  useConnections,
  useResolvedConnectionId,
  useSavedQueries,
  useStoreActions,
  useTabs,
} from '@/store/selectors';
import type { SavedQuery } from '@/types';

type SortKey = 'name' | 'createdAt' | 'updatedAt';
const SORT_KEYS: readonly SortKey[] = ['name', 'updatedAt', 'createdAt'];

function sortIconFor(key: SortKey) {
  if (key === 'name') return <ArrowDownAZ className="icon-xs" />;
  if (key === 'updatedAt') return <Clock className="icon-xs" />;
  return <CalendarPlus className="icon-xs" />;
}

function initialSort(): SortKey {
  const stored = readStoredString(STORAGE_KEYS.savedSort, 'name');
  return (SORT_KEYS as readonly string[]).includes(stored) ? (stored as SortKey) : 'name';
}

interface SavedQueriesPanelProps {
  onOpenSavedQuery: (saved: SavedQuery) => void;
}

export function SavedQueriesPanel({ onOpenSavedQuery }: SavedQueriesPanelProps) {
  const { t } = useTranslation();
  const savedQueries = useSavedQueries();
  const connections = useConnections();
  const activeTab = useActiveTab();
  const tabs = useTabs();
  const { updateTab } = useStoreActions();
  const { pinned, isPinned, toggle: togglePin } = usePinnedQueries();

  const [filter, setFilter] = useState('');
  const [scope, setScope] = useState<'all' | 'connection'>('connection');
  const [sort, setSort] = useState<SortKey>(initialSort);
  const [renameTarget, setRenameTarget] = useState<SavedQuery | null>(null);
  const { menu, openMenu, closeMenu } = useContextMenu();

  const { onKeyDown } = useListKeyboardNav();

  const connectionById = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);

  const resolvedConnId = useResolvedConnectionId();

  const changeSort = useCallback((next: SortKey) => {
    setSort(next);
    writeStoredString(STORAGE_KEYS.savedSort, next);
  }, []);

  const sortedFiltered = useMemo(() => {
    const connId = activeTab?.connectionId || resolvedConnId;
    let list = [...(savedQueries ?? [])];

    if (scope === 'connection' && connId) {
      list = list.filter((item) => !item.connectionId || item.connectionId === connId);
    }

    const needle = filter.trim().toLowerCase();
    if (needle) {
      list = list.filter((item) => {
        const conn = item.connectionId ? connectionById.get(item.connectionId) : undefined;
        return (
          item.name.toLowerCase().includes(needle) ||
          (item.sql ?? '').toLowerCase().includes(needle) ||
          (conn?.name ?? '').toLowerCase().includes(needle)
        );
      });
    }

    const dateMs = (iso: string) => {
      const parsed = Date.parse(iso);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    list.sort((a, b) => {
      if (sort === 'name') {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
      if (sort === 'createdAt') return dateMs(b.createdAt) - dateMs(a.createdAt);
      return dateMs(b.updatedAt) - dateMs(a.updatedAt);
    });
    return list;
  }, [savedQueries, scope, sort, filter, activeTab?.connectionId, resolvedConnId, connectionById]);

  // Pinned float to top; sort order preserved within each group.
  const displayed = useMemo(() => {
    const pin: SavedQuery[] = [];
    const rest: SavedQuery[] = [];
    for (const q of sortedFiltered) (pinned.has(q.id) ? pin : rest).push(q);
    return [...pin, ...rest];
  }, [sortedFiltered, pinned]);

  const confirmRename = async (name: string) => {
    const item = renameTarget;
    if (!item || name === item.name) {
      setRenameTarget(null);
      return;
    }
    try {
      const saved = await api.saveSavedQuery({ ...item, name });
      for (const tab of tabs) {
        if (tab.savedQueryId === item.id) updateTab(tab.id, { title: saved.name });
      }
      await refreshSavedQueries();
    } catch (err) {
      void appError(err, t('errors.renameQueryFailed'));
    } finally {
      setRenameTarget(null);
    }
  };

  const deleteSaved = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const item = savedQueries.find((q) => q.id === id);
    const ok = await appConfirm({
      title: t('dialog.deleteSavedTitle'),
      description: item
        ? t('dialog.deleteSavedDescription', { name: item.name })
        : t('dialog.deleteSavedDescriptionGeneric'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      const deleted = await api.deleteSavedQuery(id);
      if (!deleted) {
        void appError(new Error('delete failed'), t('errors.generic'));
        return;
      }
      await refreshSavedQueries();
    } catch (err) {
      void appError(err, t('errors.generic'));
      await refreshSavedQueries();
    }
  };

  const duplicate = useCallback(
    async (item: SavedQuery) => {
      try {
        await api.saveSavedQuery({
          id: '',
          name: t('sidebar.duplicateSuffix', { name: item.name }),
          connectionId: item.connectionId,
          sql: item.sql,
          createdAt: '',
          updatedAt: '',
        });
        await refreshSavedQueries();
      } catch (err) {
        void appError(err, t('errors.generic'));
      }
    },
    [t],
  );

  const openRowMenu = useCallback(
    (e: React.MouseEvent, item: SavedQuery) => {
      openMenu(e, [
        { label: t('sidebar.openQuery'), action: () => onOpenSavedQuery(item) },
        {
          label: isPinned(item.id) ? t('sidebar.unpin') : t('sidebar.pin'),
          action: () => togglePin(item.id),
        },
        { label: t('common.rename'), action: () => setRenameTarget(item) },
        { label: t('sidebar.duplicate'), action: () => void duplicate(item) },
        { label: t('sidebar.copySql'), action: () => void api.copyToClipboard(item.sql ?? '') },
        { label: '', action: () => {}, separator: true },
        { label: t('common.delete'), action: () => void deleteSaved(item.id) },
      ]);
    },
    [onOpenSavedQuery, isPinned, togglePin, duplicate, t],
  );

  const openFilterMenu = useCallback(
    (e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const labelFor: Record<SortKey, string> = {
        name: t('sidebar.sortName'),
        updatedAt: t('sidebar.sortUpdated'),
        createdAt: t('sidebar.sortCreated'),
      };
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
            action: () => setScope('connection'),
          },
          {
            label: t('sidebar.scopeAll'),
            icon: <Globe className="icon-xs" />,
            active: scope === 'all',
            action: () => setScope('all'),
          },
          { label: '', action: () => {}, separator: true },
          ...SORT_KEYS.map((key) => ({
            label: labelFor[key],
            icon: sortIconFor(key),
            active: sort === key,
            action: () => changeSort(key),
          })),
        ],
      );
    },
    [scope, sort, changeSort, t],
  );

  return (
    <>
      <div className="sidebar-filter">
        <Search className="sidebar-filter-icon" aria-hidden />
        <input
          type="search"
          className="sidebar-filter-input"
          placeholder={t('sidebar.filterSaved')}
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

      {(savedQueries?.length ?? 0) === 0 ? (
        <div className="empty-state">
          <p>{t('sidebar.noSaved')}</p>
          <p className="ui-text-xs text-muted sidebar-saved-hint">{t('sidebar.savedEmptyHint')}</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="empty-state">
          <p>
            {filter.trim()
              ? t('sidebar.noMatches')
              : scope === 'connection'
                ? t('sidebar.noSavedForConnection')
                : t('sidebar.noSaved')}
          </p>
        </div>
      ) : (
        /* biome-ignore lint/a11y/noStaticElementInteractions: keyboard-navigation container (arrow/Home/End roving focus over its focusable rows via useListKeyboardNav); not itself an interactive control. */
        <div className="sidebar-list" onKeyDown={onKeyDown}>
          {displayed.map((item, i) => {
            const conn = item.connectionId ? connectionById.get(item.connectionId) : undefined;
            const itemConnId = item.connectionId || resolvedConnId || connections[0]?.id;
            if (!itemConnId) return null;
            const pinnedNow = isPinned(item.id);
            return (
              <div
                key={item.id || `saved-${i}`}
                className="tree-item history-item"
                role="button"
                tabIndex={0}
                data-nav-item
                onClick={() => onOpenSavedQuery(item)}
                onKeyDown={rowActivateKeyDown}
                onContextMenu={(e) => openRowMenu(e, item)}
              >
                <div className="flex-1">
                  <span className="sidebar-entry-title">
                    {pinnedNow && <Pin className="sidebar-pin-icon" aria-hidden />}
                    {item.name}
                  </span>
                  {conn && scope === 'all' && <span className="sidebar-entry-sub">{conn.name}</span>}
                  <span className="sidebar-entry-sql sidebar-entry-sql--spaced">{oneLinePreview(item.sql)}</span>
                </div>
                <span className="history-item-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-tooltip={pinnedNow ? t('sidebar.unpin') : t('sidebar.pin')}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(item.id);
                    }}
                  >
                    {pinnedNow ? <PinOff className="icon-xs" /> : <Pin className="icon-xs" />}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-tooltip={t('tooltip.renameSavedQueryBtn')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameTarget(item);
                    }}
                  >
                    <Edit2 className="icon-xs" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-nav-delete
                    data-tooltip={t('tooltip.deleteSavedQuery')}
                    onClick={(e) => void deleteSaved(item.id, e)}
                  >
                    <Trash2 className="icon-xs" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}

      {renameTarget && (
        <RenameQueryDialog
          initialName={renameTarget.name}
          onClose={() => setRenameTarget(null)}
          onConfirm={(name) => void confirmRename(name)}
        />
      )}
    </>
  );
}
