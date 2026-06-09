import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect } from 'react';
import { useGridWheel } from '@/shared/hooks/useGridWheel';
import { OVERSCAN } from '@/shared/lib/grid';

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
