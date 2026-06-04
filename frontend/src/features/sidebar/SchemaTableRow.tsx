import { ChevronDown, ChevronRight, Columns3, Eye, Loader2, Table2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/shared/lib/cx';
import type { ColumnInfo, TableInfo } from '@/types';
import { columnMatchesSearch } from '@/features/sidebar/hooks/useSchemaTree';

interface SchemaTableRowProps {
  table: TableInfo;
  tableOpen: boolean;
  cols: ColumnInfo[];
  colsLoading: boolean;
  schemaSearch: string;
  onToggle: () => void;
  onContextMenuTable: (e: React.MouseEvent) => void;
  onBrowse: () => void;
  onColumnClick: (colName: string) => void;
  onColumnContextMenu: (e: React.MouseEvent, colName: string) => void;
}

export function SchemaTableRow({
  table,
  tableOpen,
  cols,
  colsLoading,
  schemaSearch,
  onToggle,
  onContextMenuTable,
  onBrowse,
  onColumnClick,
  onColumnContextMenu,
}: SchemaTableRowProps) {
  const { t } = useTranslation();

  const tableNameMatches = !schemaSearch || table.name.toLowerCase().includes(schemaSearch);
  const columnMatches =
    !!schemaSearch && cols.some((col) => columnMatchesSearch(col, schemaSearch));
  const isTableExpanded =
    tableOpen || (!!schemaSearch && !tableNameMatches && (columnMatches || colsLoading));
  const displayCols =
    !schemaSearch || tableNameMatches
      ? cols
      : cols.filter((col) => columnMatchesSearch(col, schemaSearch));

  return (
    <div>
      <div
        className="tree-item tree-item--table"
        tabIndex={0}
        data-nav-item
        data-tooltip={t('tooltip.schemaTableRow')}
        onClick={onToggle}
        onContextMenu={onContextMenuTable}
      >
        {isTableExpanded ? (
          <ChevronDown className="icon-sm" />
        ) : (
          <ChevronRight className="icon-sm" />
        )}
        <Table2 className="icon-sm icon" />
        <span className="flex-1">{table.name}</span>
        <button
          type="button"
          className="tree-row-action"
          data-tooltip={t('sidebar.browseData')}
          onClick={(e) => {
            e.stopPropagation();
            onBrowse();
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
              {schemaSearch && !tableNameMatches
                ? t('sidebar.searchingColumns')
                : t('sidebar.noColumnsFound')}
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
                  schemaSearch && columnMatchesSearch(col, schemaSearch) && 'tree-column-match'
                )}
                tabIndex={0}
                data-nav-item
                data-tooltip={t('tooltip.schemaColumnRow')}
                onClick={() => onColumnClick(col.name)}
                onContextMenu={(e) => onColumnContextMenu(e, col.name)}
              >
                <Columns3 className="icon-xs icon" />
                <span className="tree-column-name">{col.name}</span>
                {col.isPrimary && (
                  <span className="tree-column-pk" data-tooltip={t('tooltip.primaryKey')}>
                    {t('sidebar.pk')}
                  </span>
                )}
                <span className="tree-column-type">{col.dataType}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
