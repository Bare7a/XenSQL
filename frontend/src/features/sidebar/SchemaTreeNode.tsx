import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tableKey } from '@/features/sidebar/hooks/useSchemaTree';
import { routinesKey, type SchemaObjectRow } from '@/features/sidebar/lib/schemaObjects';
import { SchemaObjectGroupNode } from '@/features/sidebar/SchemaObjectGroupNode';
import { SchemaTableRow } from '@/features/sidebar/SchemaTableRow';
import { rowActivateKeyDown } from '@/shared/hooks/useListKeyboardNav';
import { iconFor } from '@/shared/lib/objectIcon';
import type { ColumnInfo, ObjectKind, SchemaInfo, SchemaObjectGroup, TableInfo } from '@/types';

// Stable ref so tables without loaded columns keep equal props (a fresh [] would defeat memo).
const EMPTY_COLS: ColumnInfo[] = [];

const SchemaIcon = iconFor('schema');
const RoutineIcon = iconFor('function');
const ROUTINE_ICON = <RoutineIcon className="icon-xs icon" />;

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
  expandedGroups: Record<string, boolean>;
  loadingGroups: Record<string, boolean>;
  objectRows: Record<string, SchemaObjectRow[]>;
  onToggleSchema: () => void;
  onToggleTable: (schemaName: string, table: string) => void;
  onTableContextMenu: (e: React.MouseEvent, schemaName: string, table: string, kind: ObjectKind) => void;
  onBrowse: (schemaName: string, table: string) => void;
  onColumnClick: (colName: string) => void;
  onColumnContextMenu: (e: React.MouseEvent, colName: string) => void;
  onToggleGroup: (schemaName: string, table: string, group: SchemaObjectGroup) => void;
  onToggleRoutines: (schemaName: string) => void;
  onObjectContextMenu: (e: React.MouseEvent, row: SchemaObjectRow) => void;
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
  expandedGroups,
  loadingGroups,
  objectRows,
  onToggleSchema,
  onToggleTable,
  onTableContextMenu,
  onBrowse,
  onColumnClick,
  onColumnContextMenu,
  onToggleGroup,
  onToggleRoutines,
  onObjectContextMenu,
}: SchemaTreeNodeProps) {
  const { t } = useTranslation();
  const routinesCacheKey = routinesKey(connId, sch.name);

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
        <SchemaIcon className="icon-sm icon" />
        <span className="tree-label">{sch.name}</span>
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
                  connId={connId}
                  schemaName={schemaName}
                  table={table}
                  tableOpen={!!expandedTables[tk]}
                  cols={tableColumns[tk] ?? EMPTY_COLS}
                  colsLoading={!!loadingColumns[tk]}
                  schemaSearch={schemaSearch}
                  expandedGroups={expandedGroups}
                  loadingGroups={loadingGroups}
                  objectRows={objectRows}
                  onToggleTable={onToggleTable}
                  onTableContextMenu={onTableContextMenu}
                  onBrowse={onBrowse}
                  onColumnClick={onColumnClick}
                  onColumnContextMenu={onColumnContextMenu}
                  onToggleGroup={onToggleGroup}
                  onObjectContextMenu={onObjectContextMenu}
                />
              );
            })}

          {!tablesLoading && !schemaSearch && (
            <SchemaObjectGroupNode
              label={t('sidebar.group.routines')}
              icon={ROUTINE_ICON}
              rowIcon={ROUTINE_ICON}
              open={!!expandedGroups[routinesCacheKey]}
              loading={!!loadingGroups[routinesCacheKey]}
              rows={objectRows[routinesCacheKey]}
              emptyLabel={t('sidebar.empty.routines')}
              testId="schema-group-routines"
              onToggle={() => onToggleRoutines(sch.name)}
              onRowContextMenu={onObjectContextMenu}
            />
          )}
        </div>
      )}
    </div>
  );
}
