import type { Virtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  displayColumns: string[];
  colWidths: string[];
  colVirtualizer: Virtualizer<HTMLDivElement, Element>;
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
  colVirtualizer,
  selectedColumns,
  sortedColumn,
  sortDirection,
  onHeaderClick,
  onSortToggle,
  onStartResize,
}: Props) {
  const { t } = useTranslation();

  // The header is the only in-flow table content, so its width (gutter + spacers + mounted
  // headers = gutter + all columns) is what gives the scroll container its scrollWidth.
  const virtualCols = colVirtualizer.getVirtualItems();
  const padLeft = virtualCols.length > 0 ? virtualCols[0].start : 0;
  const padRight = virtualCols.length > 0 ? colVirtualizer.getTotalSize() - virtualCols[virtualCols.length - 1].end : 0;

  return (
    <thead style={{ display: 'grid', position: 'sticky', top: 0, zIndex: 4 }}>
      <tr style={{ display: 'flex', width: '100%' }}>
        <th className="col-rownum" aria-label={t('results.rowHeader')} />
        {padLeft > 0 && <th className="col-virtual-spacer" style={{ width: padLeft }} aria-hidden />}
        {virtualCols.map((vc) => {
          const colPos = vc.index;
          const col = displayColumns[colPos];
          return (
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
          );
        })}
        {padRight > 0 && <th className="col-virtual-spacer" style={{ width: padRight }} aria-hidden />}
      </tr>
    </thead>
  );
}
