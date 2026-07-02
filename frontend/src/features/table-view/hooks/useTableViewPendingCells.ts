import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { primaryKeyKey, rowPrimaryKey } from '@/shared/lib/grid';
import type { TableViewPendingState } from '@/types';

interface UseTableViewPendingCellsArgs {
  rows: unknown[][];
  columns: string[];
  primaryKeys: string[];
  pending: TableViewPendingState;
  onCellEdit: (rowIdx: number, col: string, value: string | null) => void;
}

/**
 * Pending-edit bookkeeping for the table-view grid: primary-key lookups, the cell display value
 * (pending edit over raw), and the optimistic "edited" tint kept in lockstep with committed edits.
 */
export function useTableViewPendingCells({
  rows,
  columns,
  primaryKeys,
  pending,
  onCellEdit,
}: UseTableViewPendingCellsArgs) {
  const { t } = useTranslation();
  const [optimisticEdited, setOptimisticEdited] = useState<Set<string>>(new Set());

  // Keep the optimistic edit tint in lockstep with the committed pending edits. Inline commits/paste
  // update it eagerly for instant feedback; this reconciles it whenever pending changes out from
  // under the grid - most importantly on undo/redo, which rewrite pending wholesale.
  useEffect(() => {
    setOptimisticEdited((prev) => {
      const next = new Set<string>();
      for (const [pkKey, cols] of Object.entries(pending.edits)) {
        for (const col of Object.keys(cols)) next.add(`${pkKey}${col}`);
      }
      if (prev.size === next.size && [...next].every((k) => prev.has(k))) return prev;
      return next;
    });
  }, [pending.edits]);

  const rowPkKey = (rowIdx: number): string => primaryKeyKey(rowPrimaryKey(rows[rowIdx], columns, primaryKeys));

  const getCellDisplay = (rowIdx: number, colName: string, colIdx: number, pkKey: string) => {
    const pendingVal = pending.edits[pkKey]?.[colName];
    // rows can shrink under the virtualizer mid-refresh; guard like every other access here.
    const raw = pendingVal !== undefined ? pendingVal : rows[rowIdx]?.[colIdx];
    if (raw == null) return { text: t('common.null'), isNull: true };
    return { text: String(raw), isNull: false };
  };

  const getCellValue = (rowIdx: number, colIdx: number, colName: string): unknown => {
    const pendingVal = pending.edits[rowPkKey(rowIdx)]?.[colName];
    return pendingVal !== undefined ? pendingVal : rows[rowIdx]?.[colIdx];
  };

  const isRowDeletedByKey = (pkKey: string) => pending.deletes.includes(pkKey);

  const isCellEditedByKey = (pkKey: string, colName: string) => pending.edits[pkKey]?.[colName] !== undefined;

  const isRowDeleted = (rowIdx: number) => isRowDeletedByKey(rowPkKey(rowIdx));

  // Commit a cell value through the same reconcile path the inline editor and paste use: a value
  // reverted to the original drops the optimistic tint instead of recording a pending edit.
  const commitCell = (rowIdx: number, colIdx: number, colName: string, value: string | null) => {
    const origRaw = rows[rowIdx]?.[colIdx];
    const orig = origRaw == null ? null : String(origRaw);
    const reverted = (value == null ? null : String(value)) === orig;
    const optimisticKey = `${rowPkKey(rowIdx)}${colName}`;
    setOptimisticEdited((prevSet) => {
      const nextSet = new Set(prevSet);
      if (reverted) nextSet.delete(optimisticKey);
      else nextSet.add(optimisticKey);
      return nextSet;
    });
    onCellEdit(rowIdx, colName, value);
  };

  const restoreCell = (rowIdx: number, colIdx: number, colName: string) => {
    const origRaw = rows[rowIdx]?.[colIdx];
    commitCell(rowIdx, colIdx, colName, origRaw == null ? null : String(origRaw));
  };

  return {
    optimisticEdited,
    setOptimisticEdited,
    rowPkKey,
    getCellDisplay,
    getCellValue,
    isRowDeletedByKey,
    isCellEditedByKey,
    isRowDeleted,
    commitCell,
    restoreCell,
  };
}

export type TableViewPendingCells = ReturnType<typeof useTableViewPendingCells>;
