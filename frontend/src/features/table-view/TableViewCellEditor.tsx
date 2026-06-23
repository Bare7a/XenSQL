import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react';
import type { FocusCol } from '@/shared/lib/grid';

interface Props {
  rowIdx: number;
  ci: number;
  colPos: FocusCol;
  col: string;
  optimisticKey: string;
  defaultValue: string;
  rows: unknown[][];
  lastCommittedEditRef: React.RefObject<{ row: number; colPos: number } | null>;
  setOptimisticEdited: Dispatch<SetStateAction<Set<string>>>;
  setEditTick: Dispatch<SetStateAction<number>>;
  setEditing: Dispatch<SetStateAction<{ row: number; col: number } | null>>;
  onCellEdit: (rowIdx: number, col: string, value: string | null) => void;
}

export function TableViewCellEditor({
  rowIdx,
  ci,
  colPos,
  col,
  optimisticKey,
  defaultValue,
  rows,
  lastCommittedEditRef,
  setOptimisticEdited,
  setEditTick,
  setEditing,
  onCellEdit,
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
        const raw = e.target.value;
        const next = raw === '' ? null : raw;
        const origRaw = rows[rowIdx]?.[ci];
        const orig = origRaw == null ? null : String(origRaw);
        const reverted = (next == null ? null : String(next)) === orig;
        lastCommittedEditRef.current = { row: rowIdx, colPos };
        setOptimisticEdited((prevSet) => {
          const nextSet = new Set(prevSet);
          if (reverted) nextSet.delete(optimisticKey);
          else nextSet.add(optimisticKey);
          return nextSet;
        });
        // Always notify; the pane reconciles (records the edit, or clears it on revert).
        onCellEdit(rowIdx, col, next);
        setEditTick((x) => x + 1);

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
