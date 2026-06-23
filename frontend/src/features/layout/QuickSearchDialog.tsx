import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isSavedQueryOpenInTabs } from '@/features/editor/lib/savedQueryTab';
import { isTableViewOpenInTabs } from '@/features/table-view/lib/tableViewTab';
import type { ConnectionConfig, EditorTab, SavedQuery, TableInfo } from '@/types';

type QuickItem =
  | { type: 'tab'; key: string; label: string; detail?: string; color: string; tab: EditorTab }
  | {
      type: 'table';
      key: string;
      label: string;
      detail?: string;
      color: string;
      connectionId: string;
      schema: string;
      table: string;
    }
  | { type: 'saved'; key: string; label: string; detail?: string; color: string; saved: SavedQuery }
  | {
      type: 'conn';
      key: string;
      label: string;
      detail?: string;
      color: string;
      conn: ConnectionConfig;
    };

interface Props {
  open: boolean;
  tabs: EditorTab[];
  tables: Record<string, TableInfo[]>;
  savedQueries: SavedQuery[];
  connections: ConnectionConfig[];
  onClose: () => void;
  onSelectTab: (tab: EditorTab) => void;
  onOpenTable: (connectionId: string, schema: string, table: string) => void;
  onOpenSavedQuery: (saved: SavedQuery) => void;
  onOpenConnectionInNewTab: (conn: ConnectionConfig) => void;
}

const MAX_ITEMS = 10;
const FALLBACK_COLOR = 'var(--text-muted)';

export function QuickSearchDialog({
  open,
  tabs,
  tables,
  savedQueries,
  connections,
  onClose,
  onSelectTab,
  onOpenTable,
  onOpenSavedQuery,
  onOpenConnectionInNewTab,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    inputRef.current?.focus();
  }, [open]);

  const items = useMemo<QuickItem[]>(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    const match = (s: string) => (q ? s.toLowerCase().includes(q) : true);

    const connNameById = new Map(connections.map((c) => [c.id, c.name] as const));
    const connColorById = new Map(connections.map((c) => [c.id, c.color] as const));

    const tabItems: QuickItem[] = tabs
      .filter((tab) => match(tab.title) || match(connNameById.get(tab.connectionId) ?? ''))
      .map((tab) => ({
        type: 'tab',
        key: `tab:${tab.id}`,
        label: tab.title,
        detail: connNameById.get(tab.connectionId),
        color: connColorById.get(tab.connectionId) ?? FALLBACK_COLOR,
        tab,
      }));

    const tableItems: QuickItem[] = [];
    for (const [mapKey, tableList] of Object.entries(tables)) {
      const colon = mapKey.indexOf(':');
      if (colon < 0) continue;
      const connectionId = mapKey.slice(0, colon);
      const schema = mapKey.slice(colon + 1);
      const connName = connNameById.get(connectionId) ?? '';
      for (const tbl of tableList) {
        if (isTableViewOpenInTabs(tabs, connectionId, schema, tbl.name)) continue;
        if (!match(tbl.name) && !match(schema) && !match(connName)) continue;
        tableItems.push({
          type: 'table',
          key: `table:${connectionId}:${schema}:${tbl.name}`,
          label: tbl.name,
          detail: connName ? connName : schema,
          color: connColorById.get(connectionId) ?? FALLBACK_COLOR,
          connectionId,
          schema,
          table: tbl.name,
        });
      }
    }

    const savedItems: QuickItem[] = savedQueries
      .filter((sq) => !isSavedQueryOpenInTabs(tabs, sq))
      .filter((sq) => match(sq.name))
      .map((saved) => ({
        type: 'saved',
        key: `saved:${saved.id}`,
        label: saved.name,
        detail: saved.connectionId ? connNameById.get(saved.connectionId) : undefined,
        color: (saved.connectionId ? connColorById.get(saved.connectionId) : undefined) ?? FALLBACK_COLOR,
        saved,
      }));

    const connItems: QuickItem[] = connections
      .filter((c) => match(c.name) || match(c.host ?? '') || match(c.database ?? ''))
      .map((conn) => ({
        type: 'conn',
        key: `conn:${conn.id}`,
        label: conn.name,
        detail: conn.database ? `${conn.driver} · ${conn.database}` : conn.driver,
        color: conn.color,
        conn,
      }));

    return [...tabItems, ...tableItems, ...savedItems, ...connItems].slice(0, MAX_ITEMS);
  }, [open, query, tabs, tables, savedQueries, connections]);

  useEffect(() => {
    if (!open) return;
    if (activeIdx > items.length - 1) setActiveIdx(Math.max(0, items.length - 1));
  }, [open, activeIdx, items.length]);

  const openItem = (item: QuickItem) => {
    if (item.type === 'tab') onSelectTab(item.tab);
    else if (item.type === 'table') onOpenTable(item.connectionId, item.schema, item.table);
    else if (item.type === 'saved') onOpenSavedQuery(item.saved);
    else onOpenConnectionInNewTab(item.conn);
    onClose();
  };

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss is a redundant convenience; the dialog closes via Escape (handled in onKeyDown below).
    <div className="modal-overlay quick-search-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal quick-search-dialog"
        role="dialog"
        aria-label={t('quickSearch.title')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((i) => Math.min(items.length - 1, i + 1));
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((i) => Math.max(0, i - 1));
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const item = items[activeIdx];
            if (item) openItem(item);
          }
        }}
      >
        <div className="quick-search-input-row">
          <input
            ref={inputRef}
            className="quick-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('quickSearch.placeholder')}
            spellCheck={false}
          />
        </div>

        <div className="quick-search-list" role="listbox" aria-label={t('quickSearch.results')}>
          {items.length === 0 ? (
            <div className="quick-search-empty">{t('quickSearch.noResults')}</div>
          ) : (
            items.map((item, idx) => (
              <button
                key={item.key}
                type="button"
                className={`quick-search-item${idx === activeIdx ? ' active' : ''}`}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => openItem(item)}
              >
                <span className={`quick-search-kind kind-${item.type}`}>
                  {item.type === 'tab'
                    ? t('quickSearch.kindTab')
                    : item.type === 'table'
                      ? t('quickSearch.kindTable')
                      : item.type === 'saved'
                        ? t('quickSearch.kindSavedQuery')
                        : t('quickSearch.kindConnection')}
                </span>
                <span className="quick-search-label">
                  <span className="connection-dot" style={{ background: item.color }} />
                  <span className="quick-search-label-text">{item.label}</span>
                </span>
                {item.detail && <span className="quick-search-detail">{item.detail}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
