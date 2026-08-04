import { useCallback, useRef } from 'react';
import { type PointerDragProps, usePointerDrag } from '@/shared/hooks/usePointerDrag';

export function useColumnResize(applyColumnWidth: (colPos: number, width: number) => void): {
  resizingRef: React.RefObject<boolean>;
  startColResize: (e: React.PointerEvent, colPos: number) => void;
  colResizeProps: PointerDragProps;
} {
  const resizingRef = useRef(false);
  const { startDrag, dragProps } = usePointerDrag();

  const startColResize = useCallback(
    (e: React.PointerEvent, colPos: number) => {
      // Keeps the header's own click handler from treating the drag as a sort toggle.
      e.stopPropagation();
      resizingRef.current = true;
      const startX = e.clientX;
      const th = (e.target as HTMLElement).parentElement;
      const startW = th?.getBoundingClientRect().width ?? 100;
      startDrag(e, {
        onMove: (ev) => applyColumnWidth(colPos, Math.max(40, startW + (ev.clientX - startX))),
        // Deferred so the click that follows pointerup still sees the flag and is ignored.
        onEnd: () => {
          requestAnimationFrame(() => {
            resizingRef.current = false;
          });
        },
      });
    },
    [applyColumnWidth, startDrag],
  );

  return { resizingRef, startColResize, colResizeProps: dragProps };
}
