import { useEffect, useRef } from 'react';
import { isEditableTarget, isInsideGrid } from '@/shared/lib/dom';
import type { CellRange } from '@/shared/lib/gridCellRange';
import type { CopiedCells } from '@/shared/hooks/useGridCopyExport';
import {
  computePasteEdits,
  parseClipboardGrid,
  type PasteCellEdit,
} from '@/features/table-view/lib/tableViewClipboard';
import { ClipboardGetText } from '@wails/runtime/runtime';

interface UseTableViewKeyboardActionsOptions {
  isActive: boolean;
  readOnly: boolean;
  displayColumns: string[];
  rows: unknown[][];
  primaryKeys: string[];
  cellRange: CellRange | null;
  editing: { row: number; col: number } | null;
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
  focusRef: React.RefObject<{ row: number | null; colPos: number }>;
  /** The last in-grid copy; an immediate paste of the same clipboard reuses it verbatim. */
  lastCopyRef: React.RefObject<CopiedCells | null>;
  onPasteCells: (edits: PasteCellEdit[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onApply?: () => void | Promise<void>;
  onRefresh?: () => void;
}

export function useTableViewKeyboardActions({
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
}: UseTableViewKeyboardActionsOptions) {
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const onPasteCellsRef = useRef(onPasteCells);
  onPasteCellsRef.current = onPasteCells;
  const onUndoRef = useRef(onUndo);
  onUndoRef.current = onUndo;
  const onRedoRef = useRef(onRedo);
  onRedoRef.current = onRedo;

  // Ctrl+V pastes a (multi-)cell grid anchored at the focused cell; Ctrl+Z / Ctrl+Shift+Z (and
  // Ctrl+Y) undo/redo pending changes; Ctrl+S applies them; Ctrl+R / F5 refresh the page.
  useEffect(() => {
    if (!isActive) return;

    const readClipboardText = async (): Promise<string> => {
      try {
        return await ClipboardGetText();
      } catch {
        return navigator.clipboard.readText();
      }
    };

    const resolvePasteTarget = (): { row: number; colPos: number } | null => {
      // Anchor at the top-left of an active selection (so a destination range pastes from its corner,
      // not the drag end); fall back to the focused cell when nothing is range-selected.
      if (cellRange) return { row: cellRange.r0, colPos: cellRange.c0 };
      const { row, colPos } = focusRef.current;
      if (row != null && colPos >= 0) return { row, colPos };
      return null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // F5 needs no modifier; every other shortcut below is Ctrl/Cmd-based.
      const isF5 = e.key === 'F5';
      if (!isF5 && !(e.ctrlKey || e.metaKey)) return;

      const key = e.key.toLowerCase();
      if (!isInsideGrid(e.target, document.activeElement, tableWrapRef.current, '.table-view-grid')) return;

      // F5 or Ctrl+R refreshes the page (preventDefault stops the WebView from reloading).
      if (isF5 || key === 'r') {
        if (!onRefreshRef.current) return;
        e.preventDefault();
        onRefreshRef.current();
        return;
      }

      // Undo/redo of pending edits & deletes. Skip editable targets so the inline cell editor and
      // filter input keep their native text undo.
      if (key === 'z') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) onRedoRef.current();
        else onUndoRef.current();
        return;
      }
      if (key === 'y') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        onRedoRef.current();
        return;
      }

      if (key === 'v') {
        if (readOnly || primaryKeys.length === 0) return;
        if (isEditableTarget(e.target) && editing != null) return;
        const pasteAt = resolvePasteTarget();
        if (pasteAt == null) return;
        e.preventDefault();
        void (async () => {
          const raw = await readClipboardText();
          // Prefer the captured copy when the clipboard is still our copy verbatim - exact cells,
          // NULLs intact, no parse ambiguity. Otherwise parse the (possibly external) clipboard.
          const buffer = lastCopyRef.current;
          const cells = buffer && raw === buffer.text ? buffer.cells : parseClipboardGrid(raw);
          if (cells.length === 0) return;
          const edits = computePasteEdits(
            cells,
            pasteAt.row,
            pasteAt.colPos,
            rows.length,
            displayColumns
          );
          if (edits.length === 0) return;
          onPasteCellsRef.current(edits);
        })();
        return;
      }

      if (key === 's') {
        if (!onApplyRef.current) return;
        e.preventDefault();
        void onApplyRef.current();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isActive, cellRange, displayColumns, editing, focusRef, lastCopyRef, primaryKeys, readOnly, rows, tableWrapRef]);
}
