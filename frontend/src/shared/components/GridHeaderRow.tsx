import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  displayColumns: string[];
  colWidths: string[];
  selectedColumns: Set<string>;
  sortedColumn: string | null;
  sortDirection: 'ASC' | 'DESC';
  onHeaderClick: (col: string, colPos: number, e: React.MouseEvent<HTMLTableCellElement>) => void;
  onSortToggle: (col: string) => void;
  onStartResize: (e: React.MouseEvent, colPos: number) => void;
}

export function GridHeaderRow({
  displayColumns,
  colWidths,
  selectedColumns,
  sortedColumn,
  sortDirection,
  onHeaderClick,
  onSortToggle,
  onStartResize,
}: Props) {
  const { t } = useTranslation();

  return (
    <thead style={{ display: 'grid', position: 'sticky', top: 0, zIndex: 4 }}>
      <tr style={{ display: 'flex', width: '100%' }}>
        <th className="col-rownum" aria-label={t('results.rowHeader')} />
        {displayColumns.map((col, colPos) => (
          <th
            key={col}
            data-col={col}
            tabIndex={-1}
            style={{
              width: colWidths[colPos],
              minWidth: colWidths[colPos],
              position: 'relative',
            }}
            className={[
              'sortable',
              'col-header-selectable',
              selectedColumns.has(col) ? 'col-header-selected' : '',
              sortedColumn === col ? 'col-sorted' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-tooltip={t('tooltip.resultsColumnHeader')}
            onClick={(e) => onHeaderClick(col, colPos, e)}
          >
            <span className="results-col-title">{col}</span>
            <button
              type="button"
              className="results-sort-chev"
              aria-label={t('tooltip.sort')}
              onClick={(e) => {
                e.stopPropagation();
                onSortToggle(col);
              }}
            >
              {sortedColumn === col ? (
                sortDirection === 'ASC' ? (
                  <ChevronUp className="icon-xs"></ChevronUp>
                ) : (
                  <ChevronDown className="icon-xs"></ChevronDown>
                )
              ) : (
                <ChevronsUpDown className="icon-xs"></ChevronsUpDown>
              )}
            </button>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-drag column resize handle; resizing is a mouse affordance and columns remain readable without it. */}
            <div className="col-resize-handle" onMouseDown={(e) => onStartResize(e, colPos)} />
          </th>
        ))}
      </tr>
    </thead>
  );
}
