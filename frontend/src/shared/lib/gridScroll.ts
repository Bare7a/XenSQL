export type ScrollSnapshot = { top: number; left: number };

export function captureScrollSnapshot(wrap: HTMLElement | null): ScrollSnapshot | null {
  if (!wrap) return null;
  return { top: wrap.scrollTop, left: wrap.scrollLeft };
}

export function applyScrollSnapshot(
  wrap: HTMLElement | null,
  snap: ScrollSnapshot
): void {
  if (!wrap) return;
  wrap.scrollTop = snap.top;
  wrap.scrollLeft = snap.left;
}

/** Apply and clear a pending snapshot (fallback if layout restore did not run yet). */
export function restoreScrollSnapshot(
  snapshotRef: { current: ScrollSnapshot | null },
  wrap: HTMLElement | null
): void {
  const snap = snapshotRef.current;
  if (!snap) return;
  applyScrollSnapshot(wrap, snap);
  snapshotRef.current = null;
}

/** Nudge scroll so a focused cell clears sticky header/rownum and optional rows above it. */
export function adjustGridCellScrollInWrap(
  wrap: HTMLElement,
  el: HTMLElement,
  { rowsAbove = 0, rowHeight = 0 }: { rowsAbove?: number; rowHeight?: number } = {}
) {
  const headerH = wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0;
  const rownumW = wrap.querySelector('.col-rownum')?.getBoundingClientRect().width ?? 0;
  const wrapRect = wrap.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  
  const visibleTop = wrapRect.top + headerH + rowsAbove * rowHeight;
  const visibleBottom = wrapRect.top + wrap.clientHeight;
  const visibleLeft = wrapRect.left + rownumW;
  const visibleRight = wrapRect.left + wrap.clientWidth;

  if (elRect.top < visibleTop) wrap.scrollTop -= visibleTop - elRect.top;
  if (elRect.bottom > visibleBottom) wrap.scrollTop += elRect.bottom - visibleBottom;
  if (elRect.left < visibleLeft) wrap.scrollLeft -= visibleLeft - elRect.left;
  if (elRect.right > visibleRight) wrap.scrollLeft += elRect.right - visibleRight;
}
