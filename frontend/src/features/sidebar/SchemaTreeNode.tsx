import { ChevronDown, ChevronRight, FolderOpen, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tableKey } from '@/features/sidebar/hooks/useSchemaTree';
import { SchemaTableRow } from '@/features/sidebar/SchemaTableRow';
import { rowActivateKeyDown } from '@/shared/hooks/useListKeyboardNav';
import type { ColumnInfo, SchemaInfo, TableInfo } from '@/types';

// Stable ref so tables without loaded columns keep equal props (a fresh [] would defeat memo).
const EMPTY_COLS: ColumnInfo[] = [];

interface SchemaTreeNodeProps {
  connId: string;
  sch: SchemaInfo;
  schemaExpanded: boolean;
  allTables: TableInfo[];
  visibleTables: TableInfo[];
  tablesLoading: boolean;
  schemaSearch: string;
  expandedTables: Record<string, boolean>;
  tableColumns: Record<string, ColumnInfo[]>;
  loadingColumns: Record<string, boolean>;
  onToggleSchema: () => void;
  onToggleTable: (schemaName: string, table: string) => void;
  onTableContextMenu: (e: React.MouseEvent, schemaName: string, table: string) => void;
  onBrowse: (schemaName: string, table: string) => void;
  onColumnClick: (colName: string) => void;
  onColumnContextMenu: (e: React.MouseEvent, colName: string) => void;
}

export function SchemaTreeNode({
  connId,
  sch,
  schemaExpanded,
  allTables,
  visibleTables,
  tablesLoading,
  schemaSearch,
  expandedTables,
  tableColumns,
  loadingColumns,
  onToggleSchema,
  onToggleTable,
  onTableContextMenu,
  onBrowse,
  onColumnClick,
  onColumnContextMenu,
}: SchemaTreeNodeProps) {
  const { t } = useTranslation();

  return (
    <div>
      <div
        className="tree-item"
        role="button"
        tabIndex={0}
        data-nav-item
        data-testid="schema-node"
        data-schema={sch.name}
        onClick={onToggleSchema}
        onKeyDown={rowActivateKeyDown}
      >
        {schemaExpanded ? <ChevronDown className="icon-sm" /> : <ChevronRight className="icon-sm" />}
        <FolderOpen className="icon-sm icon" />
        <span className="flex-1">{sch.name}</span>
        {allTables.length > 0 && (
          <span className="ui-text-2xs text-muted">
            {schemaSearch ? `${visibleTables.length}/${allTables.length}` : allTables.length}
          </span>
        )}
      </div>

      {schemaExpanded && (
        <div className="tree-children">
          {tablesLoading && (
            <div className="tree-item text-muted">
              <Loader2 className="icon-xs spin" /> {t('sidebar.loadingTables')}
            </div>
          )}
          {!tablesLoading && allTables.length === 0 && (
            <div className="tree-item ui-text-xs text-muted">{t('sidebar.noTablesRefresh')}</div>
          )}
          {!tablesLoading &&
            visibleTables.map((table) => {
              const schemaName = table.schema || sch.name;
              const tk = tableKey(connId, schemaName, table.name);
              return (
                <SchemaTableRow
                  key={`${schemaName}-${table.name}`}
                  schemaName={schemaName}
                  table={table}
                  tableOpen={!!expandedTables[tk]}
                  cols={tableColumns[tk] ?? EMPTY_COLS}
                  colsLoading={!!loadingColumns[tk]}
                  schemaSearch={schemaSearch}
                  onToggleTable={onToggleTable}
                  onTableContextMenu={onTableContextMenu}
                  onBrowse={onBrowse}
                  onColumnClick={onColumnClick}
                  onColumnContextMenu={onColumnContextMenu}
                />
              );
            })}
        </div>
      )}
    </div>
  );
}
