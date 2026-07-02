import { useState } from 'react';
import type { TableViewPendingCells } from '@/features/table-view/hooks/useTableViewPendingCells';

interface UseTableViewCellViewerArgs {
  columns: string[];
  colIndices: number[];
  pendingCells: TableViewPendingCells;
}

interface CellViewerState {
  row: number;
  ci: number;
  col: string;
  value: string;
  isNull: boolean;
}

/** Cell viewer/editor modal state for the table-view grid (Shift+Enter / context "Edit"). */
export function useTableViewCellViewer({ columns, colIndices, pendingCells }: UseTableViewCellViewerArgs) {
  const [cellViewer, setCellViewer] = useState<CellViewerState | null>(null);

  const openCellViewer = (rowIdx: number, colPos: number) => {
    const ci = colIndices[colPos];
    const col = columns[ci];
    if (col == null) return;

    const raw = pendingCells.getCellValue(rowIdx, ci, col);
    const isNull = raw == null;
    setCellViewer({ row: rowIdx, ci, col, value: isNull ? '' : String(raw), isNull });
  };

  const closeCellViewer = () => setCellViewer(null);

  const saveCellViewer = (nextRaw: string) => {
    if (!cellViewer) return;
    pendingCells.commitCell(cellViewer.row, cellViewer.ci, cellViewer.col, nextRaw === '' ? null : nextRaw);
    setCellViewer(null);
  };

  const setNullFromViewer = () => {
    if (!cellViewer) return;
    pendingCells.commitCell(cellViewer.row, cellViewer.ci, cellViewer.col, null);
    setCellViewer(null);
  };

  return { cellViewer, openCellViewer, closeCellViewer, saveCellViewer, setNullFromViewer };
}
