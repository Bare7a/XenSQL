import type { Dispatch, SetStateAction } from 'react';
import type { FocusCol } from '@/shared/lib/grid';
import type { CellRange } from '@/shared/lib/gridCellRange';
import { gridSelectionHighlightClasses } from '@/shared/lib/gridCellRange';
import { TableViewCellEditor } from '@/features/table-view/TableViewCellEditor';

interface Props {
  rowIdx: number;
  colPos: FocusCol;
  ci: number;
  col: string;
  text: string;
  isNull: boolean;
  edited: boolean;
  isEditing: boolean;
  isFocusedCell: boolean;
  deleted: boolean;
  optimisticKey: string;
  colWidth: string;
  hasCellSelection: boolean;
  hasRowColSelection: boolean;
  cellRange: CellRange | null;
  selectedSortedRows: Set<number>;
  selectedColPositions: Set<number>;
  rowCount: number;
  colCount: number;
  rows: unknown[][];
  lastCommittedEditRef: React.RefObject<{ row: number; colPos: number } | null>;
  setOptimisticEdited: Dispatch<SetStateAction<Set<string>>>;
  setEditTick: Dispatch<SetStateAction<number>>;
  setEditing: Dispatch<SetStateAction<{ row: number; col: number } | null>>;
  onCellEdit: (rowIdx: number, col: string, value: string | null) => void;
  focusRow: (globalIdx: number, colPos?: FocusCol) => void;
  focusElement: (globalIdx: number, colPos: FocusCol) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onFocus: () => void;
  onClick: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDoubleClick: () => void;
}

export function TableViewCell({
  rowIdx,
  colPos,
  ci,
  col,
  text,
  isNull,
  edited,
  isEditing,
  isFocusedCell,
  deleted,
  optimisticKey,
  colWidth,
  hasCellSelection,
  hasRowColSelection,
  cellRange,
  selectedSortedRows,
  selectedColPositions,
  rowCount,
  colCount,
  rows,
  lastCommittedEditRef,
  setOptimisticEdited,
  setEditTick,
  setEditing,
  onCellEdit,
  focusRow,
  focusElement,
  onMouseDown,
  onFocus,
  onClick,
  onKeyDown,
  onDoubleClick,
}: Props) {
  return (
    <td
      id={`tableview-cell-${rowIdx}-${ci}`}
      data-row={rowIdx}
      data-col-pos={colPos}
      tabIndex={0}
      style={{ width: colWidth, minWidth: colWidth }}
      className={[
        isNull ? 'null-val' : '',
        'cell-preview',
        'cell-focusable',
        edited ? 'cell-pending-edit' : '',
        isFocusedCell && !edited && !hasCellSelection && !hasRowColSelection
          ? 'cell-focused'
          : '',
        gridSelectionHighlightClasses(
          rowIdx,
          colPos,
          cellRange,
          selectedSortedRows,
          selectedColPositions,
          rowCount,
          colCount
        ),
        isEditing ? 'editing' : '',
        deleted ? 'row-pending-delete' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseDown={onMouseDown}
      onFocus={onFocus}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    >
      {isEditing ? (
        <TableViewCellEditor
          rowIdx={rowIdx}
          ci={ci}
          colPos={colPos}
          col={col}
          optimisticKey={optimisticKey}
          defaultValue={isNull ? '' : text}
          rows={rows}
          lastCommittedEditRef={lastCommittedEditRef}
          setOptimisticEdited={setOptimisticEdited}
          setEditTick={setEditTick}
          setEditing={setEditing}
          onCellEdit={onCellEdit}
          focusRow={focusRow}
          focusElement={focusElement}
        />
      ) : (
        text
      )}
    </td>
  );
}
