import { CircleAlert, Copy, Loader2, Plug, RefreshCw, Upload } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildQualifiedTable } from '@/features/editor/lib/sqlQuoting';
import { ImportDialog } from '@/features/import/ImportDialog';
import { tableKey, tableMatchesSearch, useSchemaTree } from '@/features/sidebar/hooks/useSchemaTree';
import type { SchemaObjectRow } from '@/features/sidebar/lib/schemaObjects';
import { SchemaTreeNode } from '@/features/sidebar/SchemaTreeNode';
import { SidebarFilterBar } from '@/features/sidebar/SidebarFilterBar';
import { ContextMenu } from '@/shared/components/ContextMenu';
import { useContextMenu } from '@/shared/hooks/useContextMenu';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { useListKeyboardNav } from '@/shared/hooks/useListKeyboardNav';
import { api } from '@/shared/lib/api';
import { appToast, toastError } from '@/shared/lib/appToast';
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
import type { ObjectKind, ObjectRef, SchemaObjectGroup, TableInfo } from '@/types';

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
  const [importFor, setImportFor] = useState<{ schema: string; table?: string } | null>(null);
  const { menu, openMenu, closeMenu } = useContextMenu();

  const { onKeyDown } = useListKeyboardNav();

  const connConnected = !!(connId && connectedIds[connId]);
  const schemaDriver = connections.find((c) => c.id === connId)?.driver ?? 'postgres';
  const schemaList = connId ? (schemas[connId] ?? []) : [];
  const defaultImportSchema = schemaList[0]?.name ?? '';
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
    expandedGroups,
    loadingGroups,
    objectRows,
    toggleObjectGroup,
    toggleRoutines,
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

  const fetchDDL = useCallback(
    async (ref: ObjectRef): Promise<string | null> => {
      if (!connId) return null;
      try {
        return await api.getObjectDDL(connId, ref);
      } catch (err) {
        toastError(err, t('errors.ddlFailed'));
        return null;
      }
    },
    [connId, t],
  );

  const copyDDL = useCallback(
    async (ref: ObjectRef) => {
      const ddl = await fetchDDL(ref);
      if (ddl == null) return;
      try {
        await api.copyToClipboard(ddl);
        appToast.success(t('toast.copiedDDL'));
      } catch {
        /* clipboard unavailable */
      }
    },
    [fetchDDL, t],
  );

  const openDDLInTab = useCallback(
    async (ref: ObjectRef) => {
      if (!connId) return;
      const ddl = await fetchDDL(ref);
      if (ddl == null) return;
      onOpenQuery(connId, ddl, { forceNew: true, title: t('sidebar.ddlTabTitle', { name: ref.name }) });
    },
    [connId, fetchDDL, onOpenQuery, t],
  );

  const ddlMenuItems = useCallback(
    (ref: ObjectRef) => [
      { label: t('sidebar.copyDDL'), action: () => void copyDDL(ref) },
      { label: t('sidebar.openDDLInTab'), action: () => void openDDLInTab(ref) },
    ],
    [copyDDL, openDDLInTab, t],
  );

  const openTableMenu = useCallback(
    (e: React.MouseEvent, schemaName: string, table: string, kind: ObjectKind) => {
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
        {
          label: t('sidebar.importIntoTable'),
          action: () => setImportFor({ schema: schemaName, table }),
        },
        { label: '', action: () => {}, separator: true },
        ...ddlMenuItems({ schema: schemaName, name: table, kind }),
        { label: '', action: () => {}, separator: true },
        { label: t('sidebar.insertName'), action: () => insertSqlIntoEditor(qualified) },
        { label: t('sidebar.copyName'), action: () => void copyText(table) },
        { label: t('sidebar.copyQualifiedName'), action: () => void copyText(qualified) },
      ]);
    },
    [connId, schemaDriver, onBrowseTable, onOpenQuery, copyText, ddlMenuItems, openMenu, t],
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

  const openObjectMenu = useCallback(
    (e: React.MouseEvent, row: SchemaObjectRow) => {
      openMenu(e, [
        ...ddlMenuItems(row.ref),
        { label: '', action: () => {}, separator: true },
        { label: t('sidebar.copyName'), action: () => void copyText(row.ref.name) },
      ]);
    },
    [copyText, ddlMenuItems, openMenu, t],
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
  const handleToggleGroup = useCallback(
    (schemaName: string, table: string, group: SchemaObjectGroup) => {
      if (connId) void toggleObjectGroup(connId, schemaName, table, group);
    },
    [connId, toggleObjectGroup],
  );
  const handleToggleRoutines = useCallback(
    (schemaName: string) => {
      if (connId) void toggleRoutines(connId, schemaName);
    },
    [connId, toggleRoutines],
  );

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
      <SidebarFilterBar
        value={tableSearch}
        placeholder={t('sidebar.searchTablesColumns')}
        onChange={setTableSearch}
        disabled={!connId || !connConnected}
      >
        <button
          type="button"
          className="btn btn-sm sidebar-filter-btn"
          data-testid="schema-import"
          data-tooltip={t('sidebar.importData')}
          disabled={!connId || !connConnected}
          onClick={() => setImportFor({ schema: defaultImportSchema })}
        >
          <Upload className="icon-xs" />
        </button>
        <button
          type="button"
          className="btn btn-sm sidebar-filter-btn"
          data-tooltip={t('sidebar.refreshSchema')}
          disabled={!connId || loadingSchema}
          onClick={() => connId && void loadSchema(connId)}
        >
          <RefreshCw className={cx('icon-xs', loadingSchema && 'spin')} />
        </button>
      </SidebarFilterBar>

      {schemaError && (
        <div className="sidebar-error-banner" role="alert">
          <div className="sidebar-error-banner-head">
            <CircleAlert className="icon-xs sidebar-error-banner-icon" aria-hidden />
            <span className="sidebar-error-banner-title">{t('errors.generic')}</span>
            <button
              type="button"
              className="sidebar-error-banner-copy"
              data-tooltip={t('common.copy')}
              aria-label={t('common.copy')}
              onClick={() => void copyText(schemaError)}
            >
              <Copy className="icon-xs" />
            </button>
          </div>
          <span className="sidebar-error-banner-text">{schemaError}</span>
        </div>
      )}

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
                expandedGroups={expandedGroups}
                loadingGroups={loadingGroups}
                objectRows={objectRows}
                onToggleSchema={() => {
                  if (!isOpen) void loadTables(connId, sch.name);
                  else setExpandedSchemas((e) => ({ ...e, [key]: false }));
                }}
                onToggleTable={handleToggleTable}
                onTableContextMenu={openTableMenu}
                onBrowse={handleBrowseTableRow}
                onColumnClick={handleColumnClick}
                onColumnContextMenu={openColumnMenu}
                onToggleGroup={handleToggleGroup}
                onToggleRoutines={handleToggleRoutines}
                onObjectContextMenu={openObjectMenu}
              />
            );
          })}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}

      {importFor && connId && (
        <ImportDialog
          connectionId={connId}
          schema={importFor.schema}
          tables={tables[`${connId}:${importFor.schema}`] ?? []}
          initialTable={importFor.table}
          onClose={() => setImportFor(null)}
          onImported={() => void loadSchema(connId)}
        />
      )}
    </>
  );
}
