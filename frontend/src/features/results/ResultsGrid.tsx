import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { api } from '@/shared/lib/api';
import { cx } from '@/shared/lib/cx';
import { appConfirm, appError } from '@/shared/lib/appDialog';
import { shouldCopySingleCell } from '@/shared/lib/exportResult';
import {
  rowHeightForZoom,
  type FocusCol,
  handleGridArrowKey,
  identityIndices,
  rowPrimaryKey,
} from '@/shared/lib/grid';
import { useUiZoom } from '@/shared/hooks/useUiZoom';
import { useGridVirtualizer } from '@/shared/hooks/useGridVirtualizer';
import { useGridSelectionView } from '@/shared/hooks/useGridSelectionView';
import { useGridSort } from '@/features/results/hooks/useGridSort';
import { useResultsFocusPublish } from '@/features/results/hooks/useResultsFocusPublish';
import { useGridColumns } from '@/shared/hooks/useGridColumns';
import { useGridCopyExport } from '@/shared/hooks/useGridCopyExport';
import { useGridClipboardCopy } from '@/shared/hooks/useGridClipboardCopy';
import { useGridCore } from '@/shared/hooks/useGridCore';
import type { QueryResult } from '@/types';
import { CellViewerModal } from '@/features/results/CellViewerModal';
import { ExportResultsDialog } from '@/shared/components/ExportResultsDialog';
import { ContextMenu, type ContextMenuItem } from '@/shared/components/ContextMenu';
import { ResultsGridEmpty } from '@/features/results/ResultsGridEmpty';
import { GridToolbar } from '@/shared/components/GridToolbar';
import { GridHeaderRow } from '@/shared/components/GridHeaderRow';
import { GridTable } from '@/shared/components/GridTable';
import { ColumnPicker } from '@/shared/components/ColumnPicker';
import { gridSelectionHighlightClasses } from '@/shared/lib/gridCellRange';

const EMPTY_COLUMNS: string[] = [];
const EMPTY_ROWS: unknown[][] = [];

interface Props {
  connectionId: string;
  result: QueryResult | null;
  error: string | null;
  readOnly?: boolean;
  tableMode?: { schema: string; table: string };
  /** Inactive grids stay mounted but must not respond to global shortcuts - otherwise N tabs = N copy toasts. */
  isActive: boolean;
  onRefresh?: () => void;
  onFocusedRowChange?: (row: Record<string, unknown> | null) => void;
}

function ResultsGridImpl({
  connectionId,
  result,
  error,
  readOnly,
  tableMode,
  isActive,
  onRefresh,
  onFocusedRowChange,
}: Props) {
  const { t } = useTranslation();

  const columns = result?.columns ?? EMPTY_COLUMNS;
  const rows = result?.rows ?? EMPTY_ROWS;

  const sort = useGridSort(rows, columns);
  const cols = useGridColumns(columns, sort.sortedRows);
  const {
    sortCol,
    sortDir,
    handleColumnSort: applySortToggle,
    resetSort,
    sortedRows,
    sortedRowIndices,
    globalIndexAt,
    sortedIndexOf,
  } = sort;
  const {
    displayColumns,
    colIndices,
    columnIndexByName,
    hiddenColumns,
    toggleColumn,
    showAllColumns,
    hideAllColumns,
    resetHidden,
    colWidths,
    columnsSized,
    fitColumns,
    applyColumnWidth,
  } = cols;

  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [cellViewer, setCellViewer] = useState<{
    column: string;
    value: string;
    isNull: boolean;
    globalRowIdx: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const tableWrapRef = useRef<HTMLDivElement>(null);
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = exportOpen || cellViewer != null || contextMenu != null;

  const rowHeight = rowHeightForZoom(useUiZoom());
  const rowVirtualizer = useGridVirtualizer({
    rowCount: sortedRows.length,
    rowHeight,
    tableWrapRef,
  });

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenColumns.has(c)),
    [columns, hiddenColumns]
  );

  const publishFocusedRowRef = useRef<(globalIdx: number | null) => void>(() => {});

  const grid = useGridCore({
    rowCount: sortedRows.length,
    colIndices,
    displayColumns,
    tableWrapRef,
    applyColumnWidth,
    scrollToRow: (sortedIdx) => rowVirtualizer.scrollToIndex(sortedIdx, { align: 'auto' }),
    getElementId: (type, rowIdx, colIdx) =>
      type === 'rownum' ? `result-rownum-${rowIdx}` : `result-cell-${rowIdx}-${colIdx}`,
    rowIndex: {
      globalAt: globalIndexAt,
      sortedOf: sortedIndexOf,
      sortedIndices: sortedRowIndices ?? null,
    },
    onFocusedRowChange: (globalIdx) => publishFocusedRowRef.current(globalIdx),
  });

  const {
    cellRange,
    selectedRows,
    setSelectedRows,
    selectedColumns,
    setSelectedColumns,
    focusedRowIdx,
    setFocusedRowIdx,
    setFocusedColPos,
    focusedColPos,
    isSelecting,
    rowAnchorRef,
    selectionRef,
    focusRef,
    clearSelection,
    focusRow,
    startColResize,
    handleCellMouseDown,
    handleColumnHeaderClick,
    handleRowGutterClick,
    handleCellClick,
    moveRowFocus,
  } = grid;

  useResultsFocusPublish({
    publishRef: publishFocusedRowRef,
    result,
    columns,
    visibleColumns,
    columnIndexByName,
    hiddenColumns,
    focusedRowIdx,
    streamId: result?.streamId,
    onFocusedRowChange,
  });

  const hasGrid = !error && result != null && columns.length > 0;
  const hasSelection = cellRange != null || selectedRows.size > 0 || selectedColumns.size > 0;

  // Key on streamId (not rowCount/durationMs) so streaming row appends don't wipe selection/sort/focus.
  useEffect(() => {
    setSelectedRows(new Set());
    setSelectedColumns(new Set());
    resetHidden();
    resetSort();
    setFocusedRowIdx(null);
    setFocusedColPos(0);
    rowAnchorRef.current = null;
    publishFocusedRowRef.current(null);
  }, [
    result?.streamId,
    resetSort,
    resetHidden,
    setSelectedRows,
    setSelectedColumns,
    setFocusedRowIdx,
    setFocusedColPos,
    rowAnchorRef,
  ]);

  useEffect(() => {
    if (!hasGrid || rows.length === 0) return;
    if (focusedRowIdx != null && focusedRowIdx < rows.length) return;
    const first = sortedRowIndices ? sortedRowIndices[0] : 0;
    if (first != null) {
      rowAnchorRef.current = first;
      focusRow(first, 0);
    }
  }, [hasGrid, rows.length, sortedRowIndices, focusedRowIdx, focusRow, rowAnchorRef]);

  const copyExport = useGridCopyExport({
    result,
    displayColumns,
    columnIndexByName,
    sortedRowIndices,
    sortedRowCount: sortedRows.length,
    selectionRef,
    focusRef,
  });
  const { copyFormat, setCopyFormat, exportBusy, copyToClipboard, exportToFile } = copyExport;
  const copySelectionToClipboard = useCallback(() => copyToClipboard(true), [copyToClipboard]);
  const copyButtonToClipboard = useCallback(() => copyToClipboard(false), [copyToClipboard]);

  const handleEscape = useCallback(
    (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      const { rows: selRows, cols: selCols } = selectionRef.current;
      if (selRows.size === 0 && selCols.size === 0) return false;
      e.preventDefault();
      e.stopPropagation();
      clearSelection();
      return true;
    },
    [clearSelection, selectionRef]
  );

  useGridClipboardCopy({
    isActive,
    tableWrapRef,
    gridClass: 'results-grid',
    selectionRef,
    focusRef,
    copy: copySelectionToClipboard,
    onCopyError: (err) => void appError(err, t('errors.copyFailed')),
    extraEditableSelectors: '[role="dialog"], .monaco-editor',
    overlayOpenRef,
    onEscapeClear: clearSelection,
    shouldCopy: ({ selectedRows: selRows, selectedColumns: selCols, focusedRow, focusedColPos, inGrid }) => {
      const hasGridSelection = selRows.size > 0 || selCols.size > 0;
      const singleCell = shouldCopySingleCell({
        focusedRowIdx: focusedRow,
        focusedColPos,
        selectedRows: selRows,
        selectedColumns: selCols,
      });
      return hasGridSelection || singleCell || inGrid;
    },
  });

  const {
    selectionRowsCount,
    selectionColsCount,
    selectedSortedRows,
    selectedColPositions,
  } = useGridSelectionView({
    cellRange,
    selectedRows,
    selectedColumns,
    displayColumns,
    rowCount: sortedRows.length,
    sortedIndexOf,
  });

  if (!hasGrid) {
    return <ResultsGridEmpty error={error} result={result} />;
  }

  const pks = result?.primaryKeys || [];

  const openFocusedCellViewer = () => {
    const row = focusRef.current.row;
    const colPos = focusRef.current.colPos;
    if (row == null || colPos < 0 || !result) return;
    const col = displayColumns[colPos];
    if (!col) return;
    const ci = columnIndexByName.get(col) ?? -1;
    const cell = result.rows[row][ci];
    setCellViewer({
      column: col,
      value: cell == null ? '' : String(cell),
      isNull: cell == null,
      globalRowIdx: row,
    });
  };

  const onGridKeyDown = (e: React.KeyboardEvent, sortedIdx: number, colPos: FocusCol) => {
    if (e.key === 'Escape') return handleEscape(e);
    if (e.key === 'Shift') {
      // Windows repeats modifier keydowns; macOS doesn't.
      if (!e.repeat) grid.seedShiftAnchor(sortedIdx, colPos);
      return;
    }
    if (e.key === 'Enter') {
      const { rows: selRows, cols: selCols } = selectionRef.current;
      const { row, colPos: focusedCol } = focusRef.current;
      if (
        shouldCopySingleCell({
          focusedRowIdx: row,
          focusedColPos: focusedCol,
          selectedRows: selRows,
          selectedColumns: selCols,
        })
      ) {
        e.preventDefault();
        openFocusedCellViewer();
      }
      return;
    }

    handleGridArrowKey(e, sortedIdx, colPos, sortedRows.length, colIndices.length, moveRowFocus);
  };

  const saveCellValue = async (globalRowIdx: number, col: string, newValue: string) => {
    if (readOnly || !tableMode || !pks.length) return;
    const row = rows[globalRowIdx];
    const pk = rowPrimaryKey(row, columns, pks);
    try {
      await api.updateRow(connectionId, {
        schema: tableMode.schema,
        table: tableMode.table,
        primaryKey: pk,
        changes: { [col]: newValue },
      });
      setCellViewer(null);
      onRefresh?.();
    } catch (e) {
      void appError(e, t('errors.updateRowFailed'));
    }
  };

  const deleteSelected = async () => {
    if (readOnly || !tableMode || !pks.length || selectedRows.size === 0) return;
    const count = selectedRows.size;
    const ok = await appConfirm({
      title: t('results.deleteTitle', { count }),
      description: t('results.deleteDescription', {
        count,
        schema: tableMode.schema,
        table: tableMode.table,
      }),
      confirmLabel: t('results.deleteConfirm', { count }),
      danger: true,
    });
    if (!ok) return;
    const primaryKeys = Array.from(selectedRows).map((idx) => rowPrimaryKey(rows[idx], columns, pks));
    try {
      await api.deleteRows(connectionId, {
        schema: tableMode.schema,
        table: tableMode.table,
        primaryKeys,
      });
      setSelectedRows(new Set());
      onRefresh?.();
    } catch (e) {
      void appError(e, t('errors.deleteRowsFailed'));
    }
  };

  // Plain function not useMemo: past the !hasGrid early-return; a hook call here would break hook order.
  const buildContextMenuItems = (): ContextMenuItem[] => {
    const { rows: selRows, cols: selCols } = selectionRef.current;
    const { row, colPos } = focusRef.current;
    const hasSel = selRows.size > 0 || selCols.size > 0;
    const canViewCell = row != null && colPos >= 0;
    const canDelete =
      !readOnly && !!tableMode && (result?.primaryKeys?.length ?? 0) > 0 && selRows.size > 0;

    const items: ContextMenuItem[] = [
      {
        label: t('common.copy'),
        action: () =>
          void copySelectionToClipboard().catch((e) => void appError(e, t('errors.copyFailed'))),
      },
      { label: t('results.contextExportAs'), action: () => setExportOpen(true) },
      { label: '', action: () => {}, separator: true },
      { label: t('results.contextClearSelection'), action: clearSelection, disabled: !hasSel },
    ];
    if (canViewCell) {
      items.push({ label: t('results.contextViewCell'), action: openFocusedCellViewer });
    }
    if (canDelete) {
      items.push({ label: '', action: () => {}, separator: true });
      items.push({
        label: t('results.contextDeleteRows', { count: selRows.size }),
        action: () => void deleteSelected(),
      });
    }
    return items;
  };

  const tableCanDelete = !readOnly && !!tableMode && pks.length > 0 ? selectedRows.size : 0;

  return (
    <div
      className={cx('results-grid', isSelecting && 'table-view-selecting')}
      onKeyDownCapture={(e) => {
        if (e.key === 'Escape') handleEscape(e);
      }}
    >
      <GridToolbar
        metaText={t('results.metaRows', { count: result.rowCount, ms: result.durationMs })}
        selectionRows={selectionRowsCount}
        selectionCols={selectionColsCount}
        onFitColumns={fitColumns}
        extraLeft={
          <ColumnPicker
            columns={columns}
            hidden={hiddenColumns}
            onToggle={toggleColumn}
            onShowAll={showAllColumns}
            onHideAll={hideAllColumns}
            open={columnPickerOpen}
            onOpenChange={setColumnPickerOpen}
          />
        }
        extraRight={
          tableCanDelete > 0 ? (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => void deleteSelected()}
            >
              <Trash2 className="icon-xs" /> {t('results.deleteRows', { count: tableCanDelete })}
            </button>
          ) : undefined
        }
        copyFormat={copyFormat}
        onFormatChange={setCopyFormat}
        exportBusy={exportBusy}
        onCopy={copyButtonToClipboard}
        onExportToFile={exportToFile}
        onExportAs={() => setExportOpen(true)}
      />

      <GridTable
        columnsSized={columnsSized}
        sizingClassName="results-grid-sizing"
        wrapClassName="results-table-wrap"
        tableWrapRef={tableWrapRef}
        rowVirtualizer={rowVirtualizer}
        rowHeight={rowHeight}
        colIndices={colIndices}
        onClearSelection={clearSelection}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        header={
          <GridHeaderRow
            displayColumns={displayColumns}
            colWidths={colWidths}
            selectedColumns={selectedColumns}
            sortedColumn={sortCol}
            sortDirection={sortDir}
            onHeaderClick={(col, colPos, e) => {
              e.currentTarget.focus({ preventScroll: true });
              handleColumnHeaderClick(col, colPos, e);
            }}
            onSortToggle={applySortToggle}
            onStartResize={startColResize}
          />
        }
        buildRowContext={(sortedIdx) => {
          const globalIdx = globalIndexAt(sortedIdx) as number;
          return { globalIdx, isFocusedRow: focusedRowIdx === globalIdx };
        }}
        getRowKey={(_sortedIdx, ctx) => ctx.globalIdx}
        getRowClassName={(_sortedIdx, ctx) =>
          ctx.isFocusedRow && !hasSelection ? 'row-focused' : undefined
        }
        renderRowNum={(sortedIdx, ctx) => (
          <td
            id={`result-rownum-${ctx.globalIdx}`}
            tabIndex={0}
            className={[
              'col-rownum',
              ctx.isFocusedRow && focusedColPos < 0 && !hasSelection ? 'cell-focused' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-tooltip={t('tooltip.resultsRowGutter')}
            onFocus={() => focusRow(ctx.globalIdx, -1)}
            onClick={(e) => handleRowGutterClick(ctx.globalIdx, e)}
            onKeyDown={(e) => onGridKeyDown(e, sortedIdx, -1)}
          >
            {sortedIdx + 1}
          </td>
        )}
        renderCell={(sortedIdx, colPos, ci, ctx) => {
          const cell = sortedRows[sortedIdx][ci];
          const isFocusedCell = ctx.isFocusedRow && focusedColPos === colPos;
          return (
            <td
              key={ci}
              id={`result-cell-${ctx.globalIdx}-${ci}`}
              data-row={sortedIdx}
              data-col-pos={colPos}
              tabIndex={0}
              style={{ width: colWidths[colPos], minWidth: colWidths[colPos] }}
              className={[
                cell == null ? 'null-val' : '',
                'cell-preview',
                'cell-focusable',
                isFocusedCell && !hasSelection ? 'cell-focused' : '',
                gridSelectionHighlightClasses(
                  sortedIdx,
                  colPos,
                  cellRange,
                  selectedSortedRows,
                  selectedColPositions,
                  sortedRows.length,
                  colIndices.length
                ),
              ]
                .filter(Boolean)
                .join(' ')}
              data-tooltip={t('tooltip.resultsCell')}
              onFocus={() => focusRow(ctx.globalIdx, colPos)}
              onMouseDown={(e) => handleCellMouseDown(sortedIdx, colPos, e)}
              onClick={(e) => handleCellClick(sortedIdx, ctx.globalIdx, colPos, e)}
              onKeyDown={(e) => onGridKeyDown(e, sortedIdx, colPos)}
              onDoubleClick={openFocusedCellViewer}
            >
              {cell == null ? t('common.null') : String(cell)}
            </td>
          );
        }}
      />

      {cellViewer && (
        <CellViewerModal
          column={cellViewer.column}
          value={cellViewer.value}
          isNull={cellViewer.isNull}
          onClose={() => setCellViewer(null)}
          onSave={
            !readOnly && tableMode && pks.length > 0 && !cellViewer.isNull
              ? (newValue) =>
                  void saveCellValue(cellViewer.globalRowIdx, cellViewer.column, newValue)
              : undefined
          }
        />
      )}

      {exportOpen && (
        <ExportResultsDialog
          result={result}
          sortedRowIndices={sortedRowIndices ?? identityIndices(sortedRows.length)}
          selectedRowIndices={Array.from(selectedRows).sort((a, b) => a - b)}
          visibleColumns={displayColumns}
          allColumns={columns}
          selectedColumns={Array.from(selectedColumns)}
          format={copyFormat}
          onFormatChange={setCopyFormat}
          onClose={() => setExportOpen(false)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

export const ResultsGrid = memo(ResultsGridImpl);
