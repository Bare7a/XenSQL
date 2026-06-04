import { useCallback, useEffect, useRef, useState } from 'react';

export interface VerticalSplitterOptions {
  initialPercent: number;
  minPercent: number;
  maxPercent: number;
  /** CSS selector for the container whose height = 100%; queried once at mousedown. */
  containerSelector: string;
}

export function useVerticalSplitter(opts: VerticalSplitterOptions): {
  percent: number;
  onMouseDown: (e: React.MouseEvent) => void;
} {
  const [percent, setPercent] = useState(opts.initialPercent);

  // End an in-progress drag if the component unmounts mid-resize.
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startPct = percent;
      const container = document.querySelector(opts.containerSelector) as HTMLElement | null;
      const containerHeight = container?.clientHeight ?? 0;

      const onMove = (ev: MouseEvent) => {
        if (!containerHeight) return;
        // Drag up grows the lower pane → (startY - clientY) sign.
        const delta = startY - ev.clientY;
        const nextPct = Math.min(
          opts.maxPercent,
          Math.max(opts.minPercent, startPct + (delta / containerHeight) * 100)
        );
        setPercent(nextPct);
      };
      const cleanup = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        cleanupRef.current = null;
      };
      function onUp() {
        cleanup();
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      cleanupRef.current = cleanup;
    },
    [percent, opts.containerSelector, opts.minPercent, opts.maxPercent]
  );

  return { percent, onMouseDown };
}
