import { Loader2, Plug, RefreshCw, Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildQualifiedTable } from '@/features/editor/lib/sqlIdentifiers';
import { tableKey, tableMatchesSearch, useSchemaTree } from '@/features/sidebar/hooks/useSchemaTree';
import { SchemaTreeNode } from '@/features/sidebar/SchemaTreeNode';
import { ContextMenu } from '@/shared/components/ContextMenu';
import { useContextMenu } from '@/shared/hooks/useContextMenu';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { useListKeyboardNav } from '@/shared/hooks/useListKeyboardNav';
import { api } from '@/shared/lib/api';
import { appToast } from '@/shared/lib/appToast';
import { cx } from '@/shared/lib/cx';
import { insertSqlIntoEditor } from '@/shared/lib/insertSql';
import { formatError } from '@/shared/lib/normalize';
import {
  useConnectedIds,
  useConnections,
  useResolvedConnectionId,
  useSchemas,
  useStoreActions,
} from '@/store/selectors';
import type { TableInfo } from '@/types';

interface SchemaPanelProps {
  onOpenQuery: (connId: string, sql?: string, options?: { forceNew?: boolean; title?: string }) => void;
  onBrowseTable: (connId: string, schema: string, table: string) => void;
  onOpenConnectionTab: (connId: string) => void;
}

export function SchemaPanel({ onOpenQuery, onBrowseTable, onOpenConnectionTab }: SchemaPanelProps) {
  const { t } = useTranslation();
  const connections = useConnections();
  const connectedIds = useConnectedIds();
  const connId = useResolvedConnectionId();
  const schemas = useSchemas();
  const { setConnected } = useStoreActions();

  const [tableSearch, setTableSearch] = useState('');
  const { menu, openMenu, closeMenu } = useContextMenu();

  const { onKeyDown } = useListKeyboardNav();

  const connConnected = !!(connId && connectedIds[connId]);
  const schemaDriver = connections.find((c) => c.id === connId)?.driver ?? 'postgres';
  const schemaList = connId ? (schemas[connId] ?? []) : [];
  const debouncedSearch = useDebouncedValue(tableSearch, 200);
  const schemaSearch = debouncedSearch.trim().toLowerCase();

  const {
    tables,
    expandedSchemas,
    setExpandedSchemas,
    loadingSchema,
    loadingTables,
    loadingColumns,
    tableColumns,
    expandedTables,
    schemaError,
    setSchemaError,
    loadSchema,
    loadTables,
    toggleTableColumns,
  } = useSchemaTree({ connId, connConnected, schemaList, schemaSearch });

  const copyText = useCallback(
    async (text: string) => {
      try {
        await api.copyToClipboard(text);
        appToast.success(t('toast.copiedClipboard'));
      } catch {
        /* clipboard unavailable */
      }
    },
    [t],
  );

  const openTableMenu = useCallback(
    (e: React.MouseEvent, schemaName: string, table: string) => {
      if (!connId) return;
      const cid = connId;
      const qualified = buildQualifiedTable(schemaDriver, schemaName, table);
      openMenu(e, [
        { label: t('sidebar.browseData'), action: () => onBrowseTable(cid, schemaName, table) },
        {
          label: t('sidebar.selectInNewTab'),
          action: () =>
            onOpenQuery(cid, `SELECT * FROM ${qualified} LIMIT 100;`, {
              forceNew: true,
              title: table,
            }),
        },
        {
          label: t('sidebar.countRows'),
          action: () =>
            onOpenQuery(cid, `SELECT COUNT(*) FROM ${qualified};`, {
              forceNew: true,
              title: t('sidebar.countTitle', { name: table }),
            }),
        },
        { label: '', action: () => {}, separator: true },
        { label: t('sidebar.insertName'), action: () => insertSqlIntoEditor(qualified) },
        { label: t('sidebar.copyName'), action: () => void copyText(table) },
        { label: t('sidebar.copyQualifiedName'), action: () => void copyText(qualified) },
      ]);
    },
    [connId, schemaDriver, onBrowseTable, onOpenQuery, copyText, openMenu, t],
  );

  const openColumnMenu = useCallback(
    (e: React.MouseEvent, colName: string) => {
      openMenu(e, [
        { label: t('sidebar.insertName'), action: () => insertSqlIntoEditor(colName) },
        { label: t('sidebar.copyName'), action: () => void copyText(colName) },
      ]);
    },
    [copyText, openMenu, t],
  );

  // Stable callbacks so memo(SchemaTableRow) holds across tree re-renders.
  const handleToggleTable = useCallback(
    (schemaName: string, table: string) => {
      if (connId) void toggleTableColumns(connId, schemaName, table);
    },
    [connId, toggleTableColumns],
  );
  const handleBrowseTableRow = useCallback(
    (schemaName: string, table: string) => {
      if (connId) onBrowseTable(connId, schemaName, table);
    },
    [connId, onBrowseTable],
  );
  const handleColumnClick = useCallback((colName: string) => insertSqlIntoEditor(colName), []);

  const visibleTablesByKey = useMemo<Record<string, TableInfo[]> | null>(() => {
    if (!schemaSearch || !connId) return null;
    const out: Record<string, TableInfo[]> = {};
    for (const sch of schemaList) {
      const key = `${connId}:${sch.name}`;
      const allTables = tables[key] || [];
      out[key] = allTables.filter((tbl) => {
        const schemaName = tbl.schema || sch.name;
        const tk = tableKey(connId, schemaName, tbl.name);
        return tableMatchesSearch(tbl.name, tableColumns[tk], schemaSearch);
      });
    }
    return out;
  }, [schemaSearch, connId, schemaList, tables, tableColumns]);

  if (connections.length === 0) {
    return (
      <div className="empty-state">
        <p>{t('sidebar.addConnectionFirst')}</p>
      </div>
    );
  }

  const anyVisible =
    !schemaSearch ||
    schemaList.some((sch) => {
      const key = `${connId}:${sch.name}`;
      const v = visibleTablesByKey ? (visibleTablesByKey[key] ?? []) : tables[key] || [];
      return v.length > 0 || loadingTables[key];
    });

  return (
    <>
      <div className="sidebar-schema-toolbar">
        <div className="sidebar-schema-search">
          <Search className="sidebar-filter-icon" aria-hidden />
          <input
            type="search"
            className="sidebar-filter-input"
            placeholder={t('sidebar.searchTablesColumns')}
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            disabled={!connId || !connConnected}
          />
        </div>
        <button
          type="button"
          className="btn btn-sm sidebar-filter-btn"
          data-tooltip={t('sidebar.refreshSchema')}
          disabled={!connId || loadingSchema}
          onClick={() => connId && void loadSchema(connId)}
        >
          <RefreshCw className={cx('icon-xs', loadingSchema && 'spin')} />
        </button>
      </div>

      {schemaError && <div className="ui-text-xs sidebar-error-banner text-danger">{schemaError}</div>}

      {loadingSchema && (
        <div className="tree-item text-muted">
          <Loader2 className="icon-sm spin" /> {t('sidebar.loadingSchemasTables')}
        </div>
      )}

      {!loadingSchema && connId && !connConnected && (
        <div className="empty-state sidebar-empty-compact">
          <Plug className="icon-2xl" />
          <p>{t('sidebar.notConnected')}</p>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => {
              // Auto-load effect fires once connConnected flips; no manual fetch needed.
              setSchemaError('');
              api
                .connect(connId)
                .then(() => {
                  setConnected(connId, true);
                  onOpenConnectionTab(connId);
                })
                .catch((err) => setSchemaError(formatError(err)));
            }}
          >
            <Plug className="icon-xs" /> {t('sidebar.connectButton')}
          </button>
        </div>
      )}

      {!loadingSchema && connId && connConnected && schemaList.length === 0 && !schemaError && (
        <div className="empty-state sidebar-empty-compact">
          <p>{t('sidebar.noSchemasRefresh')}</p>
        </div>
      )}

      {!loadingSchema && connId && connConnected && schemaList.length > 0 && (
        /* biome-ignore lint/a11y/noStaticElementInteractions: keyboard-navigation container (arrow/Home/End roving focus over its focusable rows via useListKeyboardNav); not itself an interactive control. */
        <div className="schema-tree" onKeyDown={onKeyDown}>
          {schemaSearch && !anyVisible && (
            <div className="empty-state sidebar-empty-compact">
              <p>{t('sidebar.noMatches')}</p>
            </div>
          )}

          {schemaList.map((sch) => {
            const key = `${connId}:${sch.name}`;
            const isOpen = expandedSchemas[key];
            const allTables = tables[key] || [];
            const visibleTables = visibleTablesByKey ? (visibleTablesByKey[key] ?? []) : allTables;
            const tablesLoading = loadingTables[key];
            if (schemaSearch && visibleTables.length === 0 && !tablesLoading) return null;
            const schemaExpanded = schemaSearch ? true : isOpen;

            return (
              <SchemaTreeNode
                key={sch.name}
                connId={connId}
                sch={sch}
                schemaExpanded={!!schemaExpanded}
                allTables={allTables}
                visibleTables={visibleTables}
                tablesLoading={!!tablesLoading}
                schemaSearch={schemaSearch}
                expandedTables={expandedTables}
                tableColumns={tableColumns}
                loadingColumns={loadingColumns}
                onToggleSchema={() => {
                  if (!isOpen) void loadTables(connId, sch.name);
                  else setExpandedSchemas((e) => ({ ...e, [key]: false }));
                }}
                onToggleTable={handleToggleTable}
                onTableContextMenu={openTableMenu}
                onBrowse={handleBrowseTableRow}
                onColumnClick={handleColumnClick}
                onColumnContextMenu={openColumnMenu}
              />
            );
          })}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </>
  );
}
