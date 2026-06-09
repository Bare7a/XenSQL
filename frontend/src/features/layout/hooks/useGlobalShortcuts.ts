import { useEffect } from 'react';
import { isEditableTarget, isInsideGrid } from '@/shared/lib/dom';
import { getEffectiveBinding, isCapturingBinding, matchesBinding, type ShortcutDef } from '@/shared/lib/shortcuts';

export type GlobalShortcutHandlers = {
  [shortcutId in ShortcutDef['id']]?: () => void;
};

export function useGlobalShortcuts(handlers: GlobalShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Suppress all shortcuts while the Shortcuts dialog is recording a binding.
      if (isCapturingBinding()) return;

      // Prevent browser "select all page text" outside editors and grids (grids handle Ctrl+A).
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'a' &&
        !isEditableTarget(e.target, '.monaco-editor') &&
        !isInsideGrid(e.target, null)
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      for (const [id, handler] of Object.entries(handlers)) {
        if (!handler) continue;
        if (matchesBinding(e, getEffectiveBinding(id))) {
          e.preventDefault();
          handler();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handlers]);
}
