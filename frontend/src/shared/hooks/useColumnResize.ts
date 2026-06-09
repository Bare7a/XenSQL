import { useCallback, useRef } from 'react';

export function useColumnResize(applyColumnWidth: (colPos: number, width: number) => void) {
  const resizingRef = useRef(false);

  const startColResize = useCallback(
    (e: React.MouseEvent, colPos: number) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = true;
      const startX = e.clientX;
      const th = (e.target as HTMLElement).parentElement;
      const startW = th?.getBoundingClientRect().width ?? 100;
      const onMove = (ev: MouseEvent) => {
        applyColumnWidth(colPos, Math.max(40, startW + (ev.clientX - startX)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        requestAnimationFrame(() => {
          resizingRef.current = false;
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [applyColumnWidth],
  );

  return { resizingRef, startColResize };
}
