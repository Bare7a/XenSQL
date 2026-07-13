import { useEffect, useRef } from 'react';

import { isEditableTarget, isInsideGrid } from '@/shared/lib/dom';
import { shortcutKey } from '@/shared/lib/keyboard';

export interface ClipboardCopyContext {
  selectedRows: Set<number>;
  selectedColumns: Set<string>;
  focusedRow: number | null;
  focusedColPos: number;
  /** True when the event target or active element is inside this grid. */
  inGrid: boolean;
}

interface UseGridClipboardCopyOptions {
  /** Only the active tab subscribes - otherwise N tabs = N copy toasts. */
  isActive: boolean;
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
  gridClass: string;
  selectionRef: React.RefObject<{ rows: Set<number>; cols: Set<string> }>;
  focusRef: React.RefObject<{ row: number | null; colPos: number }>;
  copy: () => void | Promise<void>;
  onCopyError?: (err: unknown) => void;
  /** Extra selectors beyond inputs that suppress copy (e.g. dialogs, Monaco). */
  extraEditableSelectors?: string;
  /** When true the handler bails - an overlay/modal owns the keyboard. */
  overlayOpenRef?: React.RefObject<boolean>;
  shouldCopy: (ctx: ClipboardCopyContext) => boolean;
  /** Escape clears selection from the same capture-phase listener; omit for grids that handle Escape locally. */
  onEscapeClear?: () => void;
}

// Options stashed in a ref so the listener stays attached across renders without re-subscribing on every format/selection change.
export function useGridClipboardCopy(options: UseGridClipboardCopyOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const { isActive } = options;

  useEffect(() => {
    if (!isActive) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const {
        tableWrapRef,
        gridClass,
        selectionRef,
        focusRef,
        copy,
        onCopyError,
        overlayOpenRef,
        shouldCopy,
        onEscapeClear,
        extraEditableSelectors,
      } = optionsRef.current;

      if (overlayOpenRef?.current) return;

      if (onEscapeClear && e.key === 'Escape') {
        const { rows, cols } = selectionRef.current;
        if (rows.size === 0 && cols.size === 0) return;
        if (isEditableTarget(e.target, extraEditableSelectors)) return;
        e.preventDefault();
        e.stopPropagation();
        onEscapeClear();
        return;
      }

      if (!(e.ctrlKey || e.metaKey) || shortcutKey(e).toLowerCase() !== 'c') return;
      if (isEditableTarget(e.target, extraEditableSelectors)) return;

      const { rows, cols } = selectionRef.current;
      const { row, colPos } = focusRef.current;
      const inGrid = isInsideGrid(e.target, document.activeElement, tableWrapRef.current, `.${gridClass}`);

      if (
        !shouldCopy({
          selectedRows: rows,
          selectedColumns: cols,
          focusedRow: row,
          focusedColPos: colPos,
          inGrid,
        })
      ) {
        return;
      }

      e.preventDefault();
      const result = copy();
      if (onCopyError && result instanceof Promise) result.catch(onCopyError);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isActive]);
}
