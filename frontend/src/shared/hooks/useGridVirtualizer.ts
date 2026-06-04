import { useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { OVERSCAN } from '@/shared/lib/grid';
import { useGridWheel } from '@/shared/hooks/useGridWheel';

interface UseGridVirtualizerOptions {
  rowCount: number;
  rowHeight: number;
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
}

// Re-measures on rowHeight change (UI zoom) and attaches the shared wheel handler.
export function useGridVirtualizer({ rowCount, rowHeight, tableWrapRef }: UseGridVirtualizerOptions) {
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => tableWrapRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  useGridWheel(tableWrapRef);

  return rowVirtualizer;
}
