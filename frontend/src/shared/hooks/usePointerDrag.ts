import { type PointerEvent as ReactPointerEvent, useCallback, useMemo, useRef } from 'react';

export interface PointerDragHandlers {
  onMove: (e: PointerEvent) => void;
  /** Runs once when the drag ends, however it ends. */
  onEnd?: () => void;
  /** Forced on <body> for the duration of the drag, then restored. */
  cursor?: string;
  /** Suppresses text selection while dragging. */
  disableSelect?: boolean;
}

export interface PointerDragProps {
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
}

/**
 * Drag tracking via pointer capture. setPointerCapture redirects every later pointer event to the
 * element that started the drag - even once the cursor leaves it - so move/up stay ordinary React
 * props instead of window listeners. Nothing is registered globally, so unmounting mid-drag drops
 * the handlers with the element rather than leaking them for the life of the page.
 *
 * Spread `dragProps` on the same element whose handler calls `startDrag`.
 */
export function usePointerDrag(): {
  startDrag: (e: ReactPointerEvent, handlers: PointerDragHandlers) => void;
  dragProps: PointerDragProps;
} {
  const activeRef = useRef<PointerDragHandlers | null>(null);
  const restoreRef = useRef<{ cursor: string; userSelect: string } | null>(null);

  const endDrag = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;

    const restore = restoreRef.current;
    if (restore) {
      document.body.style.cursor = restore.cursor;
      document.body.style.userSelect = restore.userSelect;
      restoreRef.current = null;
    }
    active.onEnd?.();
  }, []);

  const startDrag = useCallback((e: ReactPointerEvent, handlers: PointerDragHandlers) => {
    // Keeps the drag from painting a text selection across the page.
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    activeRef.current = handlers;

    if (handlers.cursor || handlers.disableSelect) {
      restoreRef.current = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
      if (handlers.cursor) document.body.style.cursor = handlers.cursor;
      if (handlers.disableSelect) document.body.style.userSelect = 'none';
    }
  }, []);

  const dragProps = useMemo<PointerDragProps>(
    () => ({
      onPointerMove: (e) => activeRef.current?.onMove(e.nativeEvent),
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      // Capture is released early if the element is removed or the browser interrupts the gesture.
      onLostPointerCapture: endDrag,
    }),
    [endDrag],
  );

  return { startDrag, dragProps };
}
