import { type PointerEvent as ReactPointerEvent, useCallback, useState } from 'react';
import { readStoredWidth, storeWidth } from '@/features/layout/lib/panelResize';
import { type PointerDragProps, usePointerDrag } from '@/shared/hooks/usePointerDrag';
import type { StorageKey } from '@/shared/lib/storageKeys';

export interface PersistedPanelWidthOptions {
  storageKey: StorageKey;
  defaultWidth: number;
  min: number;
  max: number;
  /** 'right' = sidebar (drag right → wider); 'left' = JSON panel (drag left → wider). */
  edge: 'left' | 'right';
}

export function usePersistedPanelWidth(opts: PersistedPanelWidthOptions): {
  width: number;
  /** Spread onto the resize handle; carries both the drag start and the captured pointer events. */
  resizeProps: PointerDragProps & { onPointerDown: (e: ReactPointerEvent) => void };
} {
  const [width, setWidth] = useState(() => readStoredWidth(opts.storageKey, opts.defaultWidth, opts.min, opts.max));
  const { startDrag, dragProps } = usePointerDrag();

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const startX = e.clientX;
      const start = width;
      startDrag(e, {
        cursor: 'col-resize',
        disableSelect: true,
        onMove: (ev) => {
          const delta = ev.clientX - startX;
          const signed = opts.edge === 'right' ? delta : -delta;
          const next = Math.min(opts.max, Math.max(opts.min, start + signed));
          setWidth(next);
          storeWidth(opts.storageKey, next);
        },
      });
    },
    [width, opts.storageKey, opts.min, opts.max, opts.edge, startDrag],
  );

  return { width, resizeProps: { onPointerDown, ...dragProps } };
}
