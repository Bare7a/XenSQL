import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react';
import type { FocusCol } from '@/shared/lib/grid';

interface Props {
  rowIdx: number;
  ci: number;
  colPos: FocusCol;
  col: string;
  defaultValue: string;
  lastCommittedEditRef: React.RefObject<{ row: number; colPos: number } | null>;
  setEditing: Dispatch<SetStateAction<{ row: number; col: number } | null>>;
  onCommit: (rowIdx: number, colIdx: number, colName: string, value: string | null) => void;
}

export function TableViewCellEditor({
  rowIdx,
  ci,
  colPos,
  col,
  defaultValue,
  lastCommittedEditRef,
  setEditing,
  onCommit,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <input
      ref={inputRef}
      className="table-view-cell-input"
      defaultValue={defaultValue}
      onBlur={(e) => {
        (e.target as HTMLInputElement).closest('td')?.classList.add('cell-pending-edit');

        // Blank editor => NULL (no separate empty-string affordance); other whitespace preserved.
        // onCommit reconciles: it records the edit, or clears the tint when the value reverted.
        const raw = e.target.value;
        lastCommittedEditRef.current = { row: rowIdx, colPos };
        onCommit(rowIdx, ci, col, raw === '' ? null : raw);

        setEditing(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.stopPropagation();
          (e.target as HTMLInputElement).blur();
          return;
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          setEditing(null);
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.stopPropagation();
        }
      }}
    />
  );
}
