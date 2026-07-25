import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useUiZoom } from '@/shared/hooks/useUiZoom';
import { COL_OVERSCAN, colWidthToPx } from '@/shared/lib/grid';

/** Measure 1ch (px) inside the rendered table, so 'Nch' widths convert to the exact px flex layout uses. */
function measureChPx(wrap: HTMLDivElement | null): number | null {
  const table = wrap?.querySelector('table.data-table');
  if (!table) return null;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:0;overflow:hidden;width:100ch;';
  table.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return w > 0 ? w : null;
}

interface UseGridColumnVirtualizerOptions {
  /** Per display column, as applied to th/td inline styles. */
  colWidths: string[];
  /** The ch probe needs the real table in the DOM; false renders a placeholder without one. */
  columnsSized: boolean;
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Horizontal twin of useGridVirtualizer - mounts only the columns in view (plus overscan).
 * Selection, focus and copy state are index/name-based, so cells unmounting does not affect them.
 */
export function useGridColumnVirtualizer({ colWidths, columnsSized, tableWrapRef }: UseGridColumnVirtualizerOptions) {
  const uiZoom = useUiZoom();
  const [chPx, setChPx] = useState<number | null>(null);

  // Layout effect: a changed measurement re-renders before paint, so cell layout and
  // virtualizer offsets never disagree on a visible frame. Re-runs on zoom (ch scales with rem).
  useLayoutEffect(() => {
    if (!columnsSized) return;
    const apply = () => {
      const w = measureChPx(tableWrapRef.current);
      if (w != null) setChPx((prev) => (prev != null && Math.abs(prev - w) < 0.005 ? prev : w));
    };
    apply();
    // ch changes when the mono webfont finishes loading over the fallback font.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) apply();
    });
    return () => {
      cancelled = true;
    };
  }, [columnsSized, uiZoom, tableWrapRef]);

  const colWidthsPx = useMemo(() => {
    // Pre-probe fallback (~0.6em mono digit advance); replaced before first paint.
    const ch = chPx ?? uiZoom * 0.6;
    return colWidths.map((w) => colWidthToPx(w, ch));
  }, [colWidths, chPx, uiZoom]);

  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: colWidthsPx.length,
    getScrollElement: () => tableWrapRef.current,
    estimateSize: (i) => colWidthsPx[i],
    overscan: COL_OVERSCAN,
  });

  // The virtualizer's measurement cache doesn't observe estimateSize - reset it whenever any
  // width changes (drag resize, auto-fit re-sample, zoom, hide/show columns).
  const widthsSignature = colWidthsPx.join();
  useEffect(() => {
    colVirtualizer.measure();
  }, [widthsSignature, colVirtualizer]);

  return colVirtualizer;
}
