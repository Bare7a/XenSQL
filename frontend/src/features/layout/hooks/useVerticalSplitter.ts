import { type PointerEvent as ReactPointerEvent, useCallback, useState } from 'react';
import { type PointerDragProps, usePointerDrag } from '@/shared/hooks/usePointerDrag';

export interface VerticalSplitterOptions {
  initialPercent: number;
  minPercent: number;
  maxPercent: number;
  /** CSS selector for the container whose height = 100%; queried once at pointerdown. */
  containerSelector: string;
}

export function useVerticalSplitter(opts: VerticalSplitterOptions): {
  percent: number;
  /** Spread onto the splitter; carries both the drag start and the captured pointer events. */
  resizeProps: PointerDragProps & { onPointerDown: (e: ReactPointerEvent) => void };
} {
  const [percent, setPercent] = useState(opts.initialPercent);
  const { startDrag, dragProps } = usePointerDrag();

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const startY = e.clientY;
      const startPct = percent;
      const container = document.querySelector(opts.containerSelector) as HTMLElement | null;
      const containerHeight = container?.clientHeight ?? 0;

      startDrag(e, {
        onMove: (ev) => {
          if (!containerHeight) return;
          // Drag up grows the lower pane → (startY - clientY) sign.
          const delta = startY - ev.clientY;
          const nextPct = Math.min(
            opts.maxPercent,
            Math.max(opts.minPercent, startPct + (delta / containerHeight) * 100),
          );
          setPercent(nextPct);
        },
      });
    },
    [percent, opts.containerSelector, opts.minPercent, opts.maxPercent, startDrag],
  );

  return { percent, resizeProps: { onPointerDown, ...dragProps } };
}
