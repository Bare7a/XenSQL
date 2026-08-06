import { ChevronDown, ChevronRight, Columns3, Eye, Hash, KeyRound, Loader2, Table2, View, Zap } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { columnMatchesSearch } from '@/features/sidebar/hooks/useSchemaTree';
import { groupKey, isViewKind, type SchemaObjectRow, TABLE_GROUPS } from '@/features/sidebar/lib/schemaObjects';
import { SchemaObjectGroupNode } from '@/features/sidebar/SchemaObjectGroupNode';
import { rowActivateKeyDown } from '@/shared/hooks/useListKeyboardNav';
import { cx } from '@/shared/lib/cx';
import type { ColumnInfo, ObjectKind, SchemaObjectGroup, TableInfo } from '@/types';

const GROUP_ICON: Record<SchemaObjectGroup, React.ReactNode> = {
  indexes: <Hash className="icon-xs icon" />,
  constraints: <KeyRound className="icon-xs icon" />,
  triggers: <Zap className="icon-xs icon" />,
};

interface SchemaTableRowProps {
  connId: string;
  schemaName: string;
  table: TableInfo;
  tableOpen: boolean;
  cols: ColumnInfo[];
  colsLoading: boolean;
  schemaSearch: string;
  // Passed whole and indexed here: they change only on an explicit group toggle, so the
  // search pre-warm path that drives most re-renders still benefits from the memo.
  expandedGroups: Record<string, boolean>;
  loadingGroups: Record<string, boolean>;
  objectRows: Record<string, SchemaObjectRow[]>;
  // Stable, identity-parameterized callbacks so memo holds across tree re-renders.
  onToggleTable: (schemaName: string, table: string) => void;
  onTableContextMenu: (e: React.MouseEvent, schemaName: string, table: string, kind: ObjectKind) => void;
  onBrowse: (schemaName: string, table: string) => void;
  onColumnClick: (colName: string) => void;
  onColumnContextMenu: (e: React.MouseEvent, colName: string) => void;
  onToggleGroup: (schemaName: string, table: string, group: SchemaObjectGroup) => void;
  onObjectContextMenu: (e: React.MouseEvent, row: SchemaObjectRow) => void;
}

// Memoized so toggling/loading one table re-renders only that row, not the whole schema.
export const SchemaTableRow = memo(function SchemaTableRow({
  connId,
  schemaName,
  table,
  tableOpen,
  cols,
  colsLoading,
  schemaSearch,
  expandedGroups,
  loadingGroups,
  objectRows,
  onToggleTable,
  onTableContextMenu,
  onBrowse,
  onColumnClick,
  onColumnContextMenu,
  onToggleGroup,
  onObjectContextMenu,
}: SchemaTableRowProps) {
  const { t } = useTranslation();

  // Memoize column scans - only re-run when cols or search needle change.
  const { tableNameMatches, columnMatches, displayCols } = useMemo(() => {
    const nameMatches = !schemaSearch || table.name.toLowerCase().includes(schemaSearch);
    const colMatches = !!schemaSearch && cols.some((col) => columnMatchesSearch(col, schemaSearch));
    const visibleCols =
      !schemaSearch || nameMatches ? cols : cols.filter((col) => columnMatchesSearch(col, schemaSearch));
    return {
      tableNameMatches: nameMatches,
      columnMatches: colMatches,
      displayCols: visibleCols,
    };
  }, [cols, schemaSearch, table.name]);

  const isTableExpanded = tableOpen || (!!schemaSearch && !tableNameMatches && (columnMatches || colsLoading));
  const kind = (table.type || 'table') as ObjectKind;
  const isView = isViewKind(kind);

  return (
    <div>
      <div
        className="tree-item tree-item--table"
        role="button"
        tabIndex={0}
        data-nav-item
        data-testid="schema-table"
        data-table={table.name}
        data-object-kind={kind}
        data-tooltip={t('tooltip.schemaTableRow')}
        onClick={() => onToggleTable(schemaName, table.name)}
        onKeyDown={rowActivateKeyDown}
        onContextMenu={(e) => onTableContextMenu(e, schemaName, table.name, kind)}
      >
        {isTableExpanded ? <ChevronDown className="icon-sm" /> : <ChevronRight className="icon-sm" />}
        {isView ? <View className="icon-sm icon tree-icon--view" /> : <Table2 className="icon-sm icon" />}
        <span className="tree-label">{table.name}</span>
        {isView && <span className="tree-object-badge tree-object-badge--view">{t('sidebar.badge.view')}</span>}
        <button
          type="button"
          className="tree-row-action"
          data-testid="schema-table-browse"
          data-tooltip={t('sidebar.browseData')}
          onClick={(e) => {
            e.stopPropagation();
            onBrowse(schemaName, table.name);
          }}
        >
          <Eye className="icon-xs" />
        </button>
      </div>

      {isTableExpanded && (
        <div className="tree-children">
          {colsLoading && (
            <div className="tree-item tree-column text-muted">
              <Loader2 className="icon-xs spin" /> {t('sidebar.loadingColumns')}
            </div>
          )}
          {!colsLoading && displayCols.length === 0 && (
            <div className="tree-item tree-column ui-text-xs text-muted">
              {schemaSearch && !tableNameMatches ? t('sidebar.searchingColumns') : t('sidebar.noColumnsFound')}
            </div>
          )}
          {!colsLoading &&
            displayCols.map((col) => (
              <div
                key={col.name}
                className={cx(
                  'tree-item',
                  'tree-column',
                  'tree-column--clickable',
                  schemaSearch && columnMatchesSearch(col, schemaSearch) && 'tree-column-match',
                )}
                role="button"
                tabIndex={0}
                data-nav-item
                data-testid="schema-column"
                data-column={col.name}
                data-tooltip={t('tooltip.schemaColumnRow')}
                onClick={() => onColumnClick(col.name)}
                onKeyDown={rowActivateKeyDown}
                onContextMenu={(e) => onColumnContextMenu(e, col.name)}
              >
                <Columns3 className="icon-xs icon" />
                <span className="tree-column-name">{col.name}</span>
                {col.isPrimary && (
                  <span className="tree-column-pk" data-tooltip={t('tooltip.primaryKey')}>
                    {t('sidebar.pk')}
                  </span>
                )}
                {col.isForeign && (
                  <span className="tree-column-fk" data-tooltip={t('tooltip.foreignKey')}>
                    {t('sidebar.fk')}
                  </span>
                )}
                <span className="tree-column-type">{col.dataType}</span>
              </div>
            ))}

          {/* Collapsed until asked for, so the table-and-columns path costs no extra
              round-trips. Hidden during a search, which is a column hunt. */}
          {!schemaSearch &&
            TABLE_GROUPS.map((group) => {
              const key = groupKey(connId, schemaName, table.name, group);
              return (
                <SchemaObjectGroupNode
                  key={group}
                  label={t(`sidebar.group.${group}`)}
                  icon={GROUP_ICON[group]}
                  rowIcon={GROUP_ICON[group]}
                  open={!!expandedGroups[key]}
                  loading={!!loadingGroups[key]}
                  rows={objectRows[key]}
                  emptyLabel={t(`sidebar.empty.${group}`)}
                  testId={`schema-group-${group}`}
                  onToggle={() => onToggleGroup(schemaName, table.name, group)}
                  onRowContextMenu={onObjectContextMenu}
                />
              );
            })}
        </div>
      )}
    </div>
  );
});
