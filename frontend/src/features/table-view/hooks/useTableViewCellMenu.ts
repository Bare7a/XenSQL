import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TableViewPendingCells } from '@/features/table-view/hooks/useTableViewPendingCells';
import type { ContextMenuItem } from '@/shared/components/ContextMenu';
import { api } from '@/shared/lib/api';
import { appToast } from '@/shared/lib/appToast';
import type { FocusCol } from '@/shared/lib/grid';

interface UseTableViewCellMenuArgs {
  columns: string[];
  colIndices: number[];
  primaryKeys: string[];
  readOnly: boolean;
  pendingCells: TableViewPendingCells;
  focusRef: React.RefObject<{ row: number | null; colPos: FocusCol }>;
  focusRow: (row: number, colPos: FocusCol) => void;
  focusElement: (row: number, colPos: FocusCol) => void;
  openCellViewer: (rowIdx: number, colPos: number) => void;
  onToggleDeleteRow: (rowIdx: number) => void;
}

interface CellMenuState {
  x: number;
  y: number;
  row: number;
  colPos: number;
  ci: number;
  col: string;
}

/** Right-click cell menu for the table-view grid: open/close state and the item list. */
export function useTableViewCellMenu({
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
}: UseTableViewCellMenuArgs) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<CellMenuState | null>(null);

  const closeContextMenu = () => setContextMenu(null);

  const openCellContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const td = (e.target as HTMLElement).closest('td[data-col-pos]') as HTMLElement | null;
    const row = td ? Number(td.dataset.row) : (focusRef.current.row ?? -1);
    const colPos = td ? Number(td.dataset.colPos) : Math.max(0, focusRef.current.colPos);
    const ci = colIndices[colPos];
    const col = columns[ci];
    if (!Number.isInteger(row) || row < 0 || col == null) return;
    if (td) {
      focusRow(row, colPos);
      focusElement(row, colPos);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, row, colPos, ci, col });
  };

  const copyCellValue = (rowIdx: number, ci: number, col: string) => {
    const raw = pendingCells.getCellValue(rowIdx, ci, col);
    void (async () => {
      try {
        await api.copyToClipboard(raw == null ? '' : String(raw));
        appToast.success(t('toast.copiedClipboard'));
      } catch {
        /* clipboard unavailable - nothing to recover */
      }
    })();
  };

  const buildMenuItems = (menu: CellMenuState): ContextMenuItem[] => {
    const { row, ci, col, colPos } = menu;
    const pkKey = pendingCells.rowPkKey(row);
    const deleted = pendingCells.isRowDeletedByKey(pkKey);
    const cellIsNull = pendingCells.getCellValue(row, ci, col) == null;
    const hasEdit = pendingCells.isCellEditedByKey(pkKey, col) || pendingCells.optimisticEdited.has(`${pkKey}${col}`);
    const canEdit = !readOnly && primaryKeys.length > 0;

    return [
      { label: t('common.copy'), action: () => copyCellValue(row, ci, col) },
      {
        label: t('tableView.contextEdit'),
        action: () => openCellViewer(row, colPos),
        disabled: !canEdit,
      },
      { label: '', action: () => {}, separator: true },
      {
        label: t('tableView.contextSetNull'),
        action: () => pendingCells.commitCell(row, ci, col, null),
        disabled: !canEdit || cellIsNull,
      },
      {
        label: t('tableView.contextRestore'),
        action: () => pendingCells.restoreCell(row, ci, col),
        disabled: !canEdit || !hasEdit,
      },
      { label: '', action: () => {}, separator: true },
      {
        label: deleted ? t('tableView.undeleteRow') : t('tableView.deleteRow'),
        action: () => onToggleDeleteRow(row),
        disabled: !canEdit,
      },
    ];
  };

  const menuItems = contextMenu ? buildMenuItems(contextMenu) : null;

  return { contextMenu, menuItems, openCellContextMenu, closeContextMenu };
}
