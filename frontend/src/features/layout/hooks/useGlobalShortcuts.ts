import { useEffect } from 'react';
import { isEditableTarget, isInsideGrid } from '@/shared/lib/dom';
import { shortcutKey } from '@/shared/lib/keyboard';
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
        shortcutKey(e).toLowerCase() === 'a' &&
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

      // Unhandled Ctrl/Cmd+R would reach the macOS default menu's Reload item and reload the whole
      // app. preventDefault only (no stopPropagation) so grid-level refresh handlers still run.
      if ((e.ctrlKey || e.metaKey) && shortcutKey(e).toLowerCase() === 'r') {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handlers]);
}
