import { useCallback, useEffect, useRef, useState } from 'react';
import { readStoredWidth, startPanelResize, storeWidth } from '@/features/layout/lib/panelResize';
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
  handleResize: (e: React.MouseEvent) => void;
} {
  const [width, setWidth] = useState(() => readStoredWidth(opts.storageKey, opts.defaultWidth, opts.min, opts.max));

  // End an in-progress drag if the component unmounts mid-resize.
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const handleResize = useCallback(
    (e: React.MouseEvent) => {
      const start = width;
      cleanupRef.current = startPanelResize(e, 'x', (delta) => {
        const signed = opts.edge === 'right' ? delta : -delta;
        const next = Math.min(opts.max, Math.max(opts.min, start + signed));
        setWidth(next);
        storeWidth(opts.storageKey, next);
      });
    },
    [width, opts.storageKey, opts.min, opts.max, opts.edge],
  );

  return { width, handleResize };
}
