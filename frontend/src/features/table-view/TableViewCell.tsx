// biome-ignore-all lint/a11y/noNoninteractiveTabindex: data-grid cells use roving tabindex for keyboard navigation; <td> can be neither a native interactive element nor carry an interactive role without tripping the inverse rule.
import type { Dispatch, SetStateAction } from 'react';
import { TableViewCellEditor } from '@/features/table-view/TableViewCellEditor';
import type { FocusCol } from '@/shared/lib/grid';
import type { CellRange } from '@/shared/lib/gridCellRange';
import { gridSelectionHighlightClasses } from '@/shared/lib/gridCellRange';

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
  colWidth: string;
  hasCellSelection: boolean;
  hasRowColSelection: boolean;
  cellRange: CellRange | null;
  selectedSortedRows: Set<number>;
  selectedColPositions: Set<number>;
  rowCount: number;
  colCount: number;
  lastCommittedEditRef: React.RefObject<{ row: number; colPos: number } | null>;
  setEditing: Dispatch<SetStateAction<{ row: number; col: number } | null>>;
  onCommitCell: (rowIdx: number, colIdx: number, colName: string, value: string | null) => void;
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
  colWidth,
  hasCellSelection,
  hasRowColSelection,
  cellRange,
  selectedSortedRows,
  selectedColPositions,
  rowCount,
  colCount,
  lastCommittedEditRef,
  setEditing,
  onCommitCell,
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
        isFocusedCell && !edited && !hasCellSelection && !hasRowColSelection ? 'cell-focused' : '',
        gridSelectionHighlightClasses(
          rowIdx,
          colPos,
          cellRange,
          selectedSortedRows,
          selectedColPositions,
          rowCount,
          colCount,
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
          defaultValue={isNull ? '' : text}
          lastCommittedEditRef={lastCommittedEditRef}
          setEditing={setEditing}
          onCommit={onCommitCell}
        />
      ) : (
        text
      )}
    </td>
  );
}
