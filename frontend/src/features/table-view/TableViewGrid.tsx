// biome-ignore-all lint/a11y/noNoninteractiveTabindex: data-grid cells use roving tabindex for keyboard navigation; a <td> can be neither a native interactive element nor carry an interactive role without tripping the inverse rule.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CellViewerModal } from '@/features/results/CellViewerModal';
import { useTableViewCellMenu } from '@/features/table-view/hooks/useTableViewCellMenu';
import { useTableViewCellViewer } from '@/features/table-view/hooks/useTableViewCellViewer';
import { useTableViewGridFocus } from '@/features/table-view/hooks/useTableViewGridFocus';
import { useTableViewKeyboardActions } from '@/features/table-view/hooks/useTableViewKeyboardActions';
import { useTableViewPendingCells } from '@/features/table-view/hooks/useTableViewPendingCells';
import type { PasteCellEdit } from '@/features/table-view/lib/tableViewClipboard';
import { buildTableViewExportResult } from '@/features/table-view/lib/tableViewExport';
import { TableViewCell } from '@/features/table-view/TableViewCell';
import { ColumnPicker } from '@/shared/components/ColumnPicker';
import { ContextMenu } from '@/shared/components/ContextMenu';
import { ExportResultsDialog } from '@/shared/components/ExportResultsDialog';
import { GridHeaderRow } from '@/shared/components/GridHeaderRow';
import { GridTable } from '@/shared/components/GridTable';
import { GridToolbar } from '@/shared/components/GridToolbar';
import { useGridClipboardCopy } from '@/shared/hooks/useGridClipboardCopy';
import { useGridColumns } from '@/shared/hooks/useGridColumns';
import { type CopiedCells, useGridCopyExport } from '@/shared/hooks/useGridCopyExport';
import { useGridCore } from '@/shared/hooks/useGridCore';
import { useGridSelectionView } from '@/shared/hooks/useGridSelectionView';
import { useGridVirtualizer } from '@/shared/hooks/useGridVirtualizer';
import { useUiZoom } from '@/shared/hooks/useUiZoom';
import {
  type FocusCol,
  handleGridArrowKey,
  identityIndices,
  rowHeightForZoom,
  type SortDirection,
} from '@/shared/lib/grid';
import { rowToJsonObject } from '@/shared/lib/rowJson';
import type { TableViewPendingState } from '@/types';

export type TableSortDir = SortDirection;

interface Props {
  columns: string[];
  columnTypes: string[];
  rows: unknown[][];
  primaryKeys: string[];
  pending: TableViewPendingState;
  tableName: string;
  readOnly: boolean;
  orderBy: string | null;
  orderDir: TableSortDir;
  loading: boolean;
  hasMore: boolean;
  isActive: boolean;
  initialHiddenColumns?: string[];
  onHiddenColumnsChange?: (cols: string[]) => void;
  onSortChange: (col: string) => void;
  onCellEdit: (rowIdx: number, col: string, value: string | null) => void;
  onPasteCells: (edits: PasteCellEdit[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleDeleteRow: (rowIdx: number) => void;
  onFocusedRowChange?: (row: Record<string, unknown> | null) => void;
  onFocusedRowIndexChange?: (rowIdx: number | null) => void;
  onLoadMore: () => void;
  onApply?: () => void | Promise<void>;
  onRefresh?: () => void;
}

// Memoized so the grid skips TableViewPane's parent-only re-renders (filter typing, focus
// tracking, apply/loading toggles) - props are stabilized there to make this hold.
export const TableViewGrid = memo(function TableViewGrid({
  columns,
  columnTypes,
  rows,
  primaryKeys,
  pending,
  tableName,
  readOnly,
  orderBy,
  orderDir,
  loading,
  hasMore,
  isActive,
  initialHiddenColumns,
  onHiddenColumnsChange,
  onSortChange,
  onCellEdit,
  onPasteCells,
  onUndo,
  onRedo,
  onToggleDeleteRow,
  onFocusedRowChange,
  onFocusedRowIndexChange,
  onLoadMore,
  onApply,
  onRefresh,
}: Props) {
  const { t } = useTranslation();
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const loadMoreLockRef = useRef(false);
  const lastCommittedEditRef = useRef<{ row: number; colPos: number } | null>(null);
  // The most recent in-grid copy, so an immediate paste reuses the exact cells (and round-trips
  // values with commas/newlines) instead of re-parsing the clipboard. Cleared implicitly when an
  // external copy makes the clipboard text no longer match.
  const lastCopyRef = useRef<CopiedCells | null>(null);
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const onFocusedRowChangeRef = useRef(onFocusedRowChange);
  onFocusedRowChangeRef.current = onFocusedRowChange;
  const onFocusedRowIndexChangeRef = useRef(onFocusedRowIndexChange);
  onFocusedRowIndexChangeRef.current = onFocusedRowIndexChange;

  const cols = useGridColumns(columns, rows, {
    initialHidden: initialHiddenColumns,
    onHiddenChange: onHiddenColumnsChange,
  });
  const {
    displayColumns,
    colIndices,
    columnIndexByName,
    hiddenColumns,
    toggleColumn,
    showAllColumns,
    hideAllColumns,
    colWidths,
    columnsSized,
    fitColumns,
    applyColumnWidth,
  } = cols;

  const rowHeight = rowHeightForZoom(useUiZoom());
  const rowVirtualizer = useGridVirtualizer({
    rowCount: rows.length,
    rowHeight,
    tableWrapRef,
  });

  const publishFocusedRow = useCallback(
    (globalIdx: number | null) => {
      if (globalIdx == null) {
        onFocusedRowChangeRef.current?.(null);
        onFocusedRowIndexChangeRef.current?.(null);
        return;
      }
      const row = rows[globalIdx];
      if (!row) return;
      onFocusedRowChangeRef.current?.(rowToJsonObject(columns, displayColumns, row));
      onFocusedRowIndexChangeRef.current?.(globalIdx);
    },
    [rows, columns, displayColumns],
  );
  const publishFocusedRowRef = useRef(publishFocusedRow);
  publishFocusedRowRef.current = publishFocusedRow;

  const getElementId = useCallback(
    (type: 'cell' | 'rownum', rowIdx: number, colIdx: number) =>
      type === 'rownum' ? `tableview-rownum-${rowIdx}` : `tableview-cell-${rowIdx}-${colIdx}`,
    [],
  );

  const grid = useGridCore({
    rowCount: rows.length,
    colIndices,
    displayColumns,
    tableWrapRef,
    applyColumnWidth,
    scrollToRow: (rowIdx) => rowVirtualizer.scrollToIndex(rowIdx, { align: 'auto' }),
    getElementId,
    onFocusedRowChange: (globalIdx) => publishFocusedRowRef.current(globalIdx),
  });

  const {
    cellRange,
    setCellRange,
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
    columnAnchorRef,
    selectionRef,
    focusRef,
    selectingRef,
    clearSelection,
    focusRow,
    focusElement,
    startColResize,
    handleCellMouseDown,
    handleColumnHeaderClick,
    handleRowGutterClick,
    handleCellClick,
    moveRowFocus,
  } = grid;

  useTableViewGridFocus({
    loading,
    editing,
    isActive,
    columnsLength: columns.length,
    rowsLength: rows.length,
    colCount: colIndices.length,
    focusedRowIdx,
    focusedColPos,
    focusRef,
    focusRow,
    setFocusedRowIdx,
    setFocusedColPos,
    tableWrapRef,
    rowVirtualizer,
    colIndices,
    getElementId,
    rowHeight,
  });

  useEffect(() => {
    const idx = focusRef.current.row;
    if (idx != null) publishFocusedRowRef.current(idx);
  }, [rows, focusRef, publishFocusedRowRef]);

  const pendingCells = useTableViewPendingCells({ rows, columns, primaryKeys, pending, onCellEdit });
  const { optimisticEdited, setOptimisticEdited, rowPkKey, getCellDisplay, isRowDeletedByKey, isCellEditedByKey } =
    pendingCells;
  const { commitCell, isRowDeleted } = pendingCells;

  const { cellViewer, openCellViewer, closeCellViewer, saveCellViewer, setNullFromViewer } = useTableViewCellViewer({
    columns,
    colIndices,
    pendingCells,
  });

  const { contextMenu, menuItems, openCellContextMenu, closeContextMenu } = useTableViewCellMenu({
    columns,
    colIndices,
    primaryKeys,
    readOnly,
    pendingCells,
    focusRef,
    focusRow,
    focusElement,
    openCellViewer,
    onToggleDeleteRow,
  });

  const rowIndices = useMemo(() => identityIndices(rows.length), [rows.length]);

  const exportResult = useMemo(
    () =>
      columns.length ? buildTableViewExportResult(columns, columnTypes, rows, primaryKeys, pending, tableName) : null,
    [columns, columnTypes, rows, primaryKeys, pending, tableName],
  );

  const copyExport = useGridCopyExport({
    result: exportResult,
    displayColumns,
    columnIndexByName,
    sortedRowIndices: rowIndices,
    sortedRowCount: rows.length,
    selectionRef,
    focusRef,
    onCopied: (copied) => {
      lastCopyRef.current = copied;
    },
  });
  const { copyFormat, setCopyFormat, exportBusy, copyToClipboard, exportToFile } = copyExport;
  const copyButtonToClipboard = useCallback(() => copyToClipboard(false), [copyToClipboard]);
  const copySelectionToClipboard = useCallback(() => copyToClipboard(true), [copyToClipboard]);

  const exportAllLoaded = useCallback(async () => {
    const saved = selectionRef.current;
    selectionRef.current = { rows: new Set(), cols: new Set() };
    try {
      await exportToFile();
    } finally {
      selectionRef.current = saved;
    }
  }, [exportToFile, selectionRef]);

  const { selectionRowsCount, selectionColsCount, selectedSortedRows, selectedColPositions } = useGridSelectionView({
    cellRange,
    selectedRows,
    selectedColumns,
    displayColumns,
    rowCount: rows.length,
  });

  const hasCellSelection = cellRange != null;
  const hasRowColSelection = selectedRows.size > 0 || selectedColumns.size > 0;

  useGridClipboardCopy({
    isActive,
    tableWrapRef,
    gridClass: 'table-view-grid',
    selectionRef,
    focusRef,
    copy: copySelectionToClipboard,
    shouldCopy: ({ selectedRows: selRows, selectedColumns: selCols, focusedRow, focusedColPos, inGrid }) =>
      inGrid && (selRows.size > 0 || selCols.size > 0 || (focusedRow != null && focusedColPos >= 0)),
  });

  useTableViewKeyboardActions({
    isActive,
    readOnly,
    displayColumns,
    rows,
    primaryKeys,
    cellRange,
    editing,
    tableWrapRef,
    focusRef,
    lastCopyRef,
    onPasteCells,
    onUndo,
    onRedo,
    onApply,
    onRefresh,
  });

  // Hidden columns are left alone - useGridColumns prunes them against the new column set.
  useEffect(() => {
    setCellRange(null);
    setSelectedRows(new Set());
    setSelectedColumns(new Set());
    rowAnchorRef.current = null;
    columnAnchorRef.current = null;
    setOptimisticEdited(new Set());
  }, [
    columns,
    tableName,
    setCellRange,
    setSelectedRows,
    setSelectedColumns,
    rowAnchorRef,
    columnAnchorRef,
    setOptimisticEdited,
  ]);

  // After blur, restore focus to the committed cell (blur fires before React re-render).
  useEffect(() => {
    if (editing != null) return;
    const last = lastCommittedEditRef.current;
    if (!last) return;
    lastCommittedEditRef.current = null;
    requestAnimationFrame(() => {
      focusRow(last.row, last.colPos);
      focusElement(last.row, last.colPos);
    });
  }, [editing, focusRow, focusElement]);

  const handleScroll = useCallback(() => {
    const el = tableWrapRef.current;
    if (!el || loading || !hasMore || loadMoreLockRef.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - rowHeight * 4) {
      loadMoreLockRef.current = true;
      onLoadMore();
    }
  }, [loading, hasMore, onLoadMore, rowHeight]);

  useEffect(() => {
    if (!loading) loadMoreLockRef.current = false;
  }, [loading]);

  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const onGridKeyDown = (e: React.KeyboardEvent, rowIdx: number, colPos: FocusCol) => {
    if (editing != null && (e.target as HTMLElement).tagName === 'INPUT') return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editing != null || readOnly || primaryKeys.length === 0) return;
      e.preventDefault();
      // Ctrl/Cmd + Delete/Backspace nulls the focused cell; plain Delete toggles row deletion.
      if ((e.ctrlKey || e.metaKey) && colPos >= 0) {
        if (!isRowDeleted(rowIdx)) commitCell(rowIdx, colIndices[colPos], columns[colIndices[colPos]], null);
        return;
      }
      onToggleDeleteRow(rowIdx);
      return;
    }

    if (e.key === 'Enter' && colPos >= 0) {
      if (readOnly || selectingRef.current) return;
      e.preventDefault();
      clearSelection();

      if (e.shiftKey) return openCellViewer(rowIdx, colPos);

      return setEditing({ row: rowIdx, col: colPos });
    }

    // Windows repeats modifier keydowns; macOS doesn't - seed anchor only on first press.
    if (e.key === 'Shift') {
      if (!e.repeat) grid.seedShiftAnchor(rowIdx, colPos);
      return;
    }

    if (handleGridArrowKey(e, rowIdx, colPos, rows.length, colIndices.length, moveRowFocus)) {
      return;
    }
    if (e.key === 'Escape' && (cellRange || selectedRows.size || selectedColumns.size)) {
      e.preventDefault();
      clearSelection();
    }
  };

  if (!columns.length) {
    return <div className="table-view-grid-empty">{loading ? t('tableView.loading') : t('results.noResults')}</div>;
  }

  return (
    <div
      className={['table-view-grid', 'results-grid', isSelecting ? 'table-view-selecting' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <GridToolbar
        metaText={t('tableView.rowCount', { count: rows.length })}
        loadingText={loading ? t('tableView.loading') : undefined}
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
        copyFormat={copyFormat}
        onFormatChange={setCopyFormat}
        exportBusy={exportBusy}
        onCopy={copyButtonToClipboard}
        onExportToFile={exportAllLoaded}
        onExportAs={() => setExportOpen(true)}
      />

      <GridTable
        columnsSized={columnsSized}
        sizingClassName="results-grid-sizing table-view-grid-sizing"
        wrapClassName="results-table-wrap table-view-table-wrap"
        tableWrapRef={tableWrapRef}
        rowVirtualizer={rowVirtualizer}
        rowHeight={rowHeight}
        colIndices={colIndices}
        onClearSelection={clearSelection}
        onContextMenu={openCellContextMenu}
        header={
          <GridHeaderRow
            displayColumns={displayColumns}
            colWidths={colWidths}
            selectedColumns={selectedColumns}
            sortedColumn={orderBy}
            sortDirection={orderDir}
            onHeaderClick={handleColumnHeaderClick}
            onSortToggle={(col) => {
              clearSelection();
              onSortChange(col);
            }}
            onStartResize={startColResize}
          />
        }
        buildRowContext={(rowIdx) => {
          const pkKey = rowPkKey(rowIdx);
          return {
            pkKey,
            deleted: isRowDeletedByKey(pkKey),
            isFocusedRow: focusedRowIdx === rowIdx,
          };
        }}
        getRowKey={(rowIdx) => rowIdx}
        getRowClassName={(_rowIdx, ctx) =>
          [
            ctx.deleted ? 'row-pending-delete' : '',
            ctx.isFocusedRow && !hasCellSelection && !hasRowColSelection ? 'row-focused' : '',
          ]
            .filter(Boolean)
            .join(' ')
        }
        renderRowNum={(rowIdx, ctx) => (
          <td
            id={`tableview-rownum-${rowIdx}`}
            tabIndex={0}
            className={[
              'col-rownum',
              ctx.deleted ? 'row-pending-delete' : '',
              ctx.isFocusedRow && focusedColPos < 0 && !hasCellSelection && !hasRowColSelection ? 'cell-focused' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onFocus={() => focusRow(rowIdx, -1)}
            onClick={(e) => handleRowGutterClick(rowIdx, e)}
            onDoubleClick={() => {
              if (!readOnly && primaryKeys.length) onToggleDeleteRow(rowIdx);
            }}
            onKeyDown={(e) => onGridKeyDown(e, rowIdx, -1)}
          >
            {rowIdx + 1}
          </td>
        )}
        renderCell={(rowIdx, colPos, ci, ctx) => {
          const col = columns[ci];
          const { text, isNull } = getCellDisplay(rowIdx, col, ci, ctx.pkKey);
          const edited = optimisticEdited.has(`${ctx.pkKey}${col}`) || isCellEditedByKey(ctx.pkKey, col);
          const isEditing = editing?.row === rowIdx && editing?.col === colPos && !readOnly;
          const isFocusedCell = ctx.isFocusedRow && focusedColPos === colPos;

          return (
            <TableViewCell
              key={ci}
              rowIdx={rowIdx}
              colPos={colPos}
              ci={ci}
              col={col}
              text={text}
              isNull={isNull}
              edited={edited}
              isEditing={isEditing}
              isFocusedCell={isFocusedCell}
              deleted={ctx.deleted}
              colWidth={colWidths[colPos]}
              hasCellSelection={hasCellSelection}
              hasRowColSelection={hasRowColSelection}
              cellRange={cellRange}
              selectedSortedRows={selectedSortedRows}
              selectedColPositions={selectedColPositions}
              rowCount={rows.length}
              colCount={colIndices.length}
              lastCommittedEditRef={lastCommittedEditRef}
              setEditing={setEditing}
              onCommitCell={commitCell}
              onMouseDown={(e) => {
                if (editing != null) return;
                handleCellMouseDown(rowIdx, colPos, e);
              }}
              onFocus={() => {
                if (focusedRowIdx !== rowIdx || focusedColPos !== colPos) {
                  focusRow(rowIdx, colPos);
                }
              }}
              onClick={(e) => handleCellClick(rowIdx, rowIdx, colPos, e)}
              onKeyDown={(e) => onGridKeyDown(e, rowIdx, colPos)}
              onDoubleClick={() => {
                if (readOnly || selectingRef.current) return;
                clearSelection();
                setEditing({ row: rowIdx, col: colPos });
              }}
            />
          );
        }}
      />

      {cellViewer && (
        <CellViewerModal
          column={cellViewer.col}
          value={cellViewer.value}
          isNull={cellViewer.isNull}
          startInEditMode={!readOnly}
          onClose={closeCellViewer}
          onSave={!readOnly ? saveCellViewer : undefined}
          onSetNull={!readOnly ? setNullFromViewer : undefined}
        />
      )}

      {exportOpen && exportResult && (
        <ExportResultsDialog
          result={exportResult}
          sortedRowIndices={rowIndices}
          selectedRowIndices={Array.from(selectedRows).sort((a, b) => a - b)}
          visibleColumns={displayColumns}
          allColumns={columns}
          selectedColumns={Array.from(selectedColumns)}
          format={copyFormat}
          onFormatChange={setCopyFormat}
          onClose={() => setExportOpen(false)}
        />
      )}

      {contextMenu && menuItems && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={menuItems} onClose={closeContextMenu} />
      )}
    </div>
  );
});
