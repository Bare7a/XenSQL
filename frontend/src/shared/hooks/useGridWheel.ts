import { useEffect, type RefObject } from 'react';

// Horizontal scroll takes priority when both axes overflow, except for dominant-deltaY vertical gestures; Shift+wheel always scrolls sideways.
export function useGridWheel(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const canScrollH = el.scrollWidth > el.clientWidth + 1;
      const canScrollV = el.scrollHeight > el.clientHeight + 1;
      if (!canScrollH && !canScrollV) return;

      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);

      const wantsVertical =
        canScrollV && !e.shiftKey && absY > absX && (absX === 0 || absY > absX * 1.5);

      if (wantsVertical) return;

      if (canScrollH) {
        const delta = e.shiftKey
          ? e.deltaY || e.deltaX
          : absX > 0
            ? e.deltaX
            : e.deltaY;
        if (delta === 0) return;
        const max = el.scrollWidth - el.clientWidth;
        const next = Math.max(0, Math.min(max, el.scrollLeft + delta));
        if (next === el.scrollLeft) return; // at the edge - let the event bubble (page/parent scroll)
        e.preventDefault();
        el.scrollLeft = next;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);
}
