import { type RefObject, useEffect, useRef } from 'react';

export interface DismissOnOutsideOptions {
  /** Skip while the popover is closed; listeners attach only when true (default). */
  enabled?: boolean;
  /** Extra elements counted as "inside", e.g. the trigger button. */
  alsoInside?: Array<RefObject<HTMLElement | null>>;
  /** Clicks with a matching ancestor are ignored, e.g. '.modal-overlay' for owned dialogs. */
  ignoreSelector?: string;
  /** Also dismiss on a right-click outside (context menus replace themselves). */
  onContextMenu?: boolean;
  /** Dismiss on Escape. Leave off when the caller already uses useModalEscape. */
  onEscape?: boolean;
}

/**
 * Dismisses a popover on mousedown outside it. Listens on window in the capture phase because the
 * click is by definition outside the React subtree, so no synthetic handler ever sees it.
 */
export function useDismissOnOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: DismissOnOutsideOptions = {},
): void {
  const { enabled = true, alsoInside, ignoreSelector, onContextMenu = false, onEscape = false } = options;

  // Ref'd so an unmemoized onClose doesn't re-subscribe on every parent re-render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const alsoInsideRef = useRef(alsoInside);
  alsoInsideRef.current = alsoInside;

  useEffect(() => {
    if (!enabled) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (ignoreSelector && target.closest(ignoreSelector)) return;
      if (ref.current?.contains(target)) return;
      for (const extra of alsoInsideRef.current ?? []) {
        if (extra.current?.contains(target)) return;
      }
      onCloseRef.current();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };

    window.addEventListener('mousedown', onPointerDown, true);
    if (onContextMenu) window.addEventListener('contextmenu', onPointerDown, true);
    if (onEscape) window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      if (onContextMenu) window.removeEventListener('contextmenu', onPointerDown, true);
      if (onEscape) window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [enabled, ref, ignoreSelector, onContextMenu, onEscape]);
}
