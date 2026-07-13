import { useEffect, useRef } from 'react';
import { GRID_KEYBOARD_SUPPRESS_SELECTOR, isEditableTarget, isInsideGrid } from '@/shared/lib/dom';
import { shortcutKey } from '@/shared/lib/keyboard';

interface UseGridGlobalKeysOptions {
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
  selectAllCells(): void;
}

export function useGridGlobalKeys({ tableWrapRef, selectAllCells }: UseGridGlobalKeysOptions) {
  const shiftHeldRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftHeldRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftHeldRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || shortcutKey(e).toLowerCase() !== 'a') return;
      if (isEditableTarget(e.target, GRID_KEYBOARD_SUPPRESS_SELECTOR)) return;
      if (isEditableTarget(document.activeElement, GRID_KEYBOARD_SUPPRESS_SELECTOR)) return;
      if (!isInsideGrid(e.target, document.activeElement, tableWrapRef.current)) return;

      e.preventDefault();
      e.stopPropagation();
      selectAllCells();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [tableWrapRef, selectAllCells]);

  return { shiftHeldRef };
}
