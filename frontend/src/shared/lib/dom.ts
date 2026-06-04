export const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

/** Nested inside grid DOM but should not receive grid keyboard shortcuts (e.g. cell viewer). */
export const GRID_KEYBOARD_SUPPRESS_SELECTOR = '.monaco-editor, .modal-overlay';

const GRID_SELECTOR = '.results-grid, .table-view-grid';

/** Resolve by id within a container - avoids duplicate ids across mounted tab layers. */
export function queryElementInContainer(
  container: HTMLElement | null | undefined,
  id: string
): HTMLElement | null {
  if (!container) return null;
  return container.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
}

export function isEditableTarget(el: EventTarget | null, extraSelectors?: string): boolean {
  const node = el as Element | null;
  if (!node?.closest) return false;
  const selector = extraSelectors ? `${EDITABLE_SELECTOR}, ${extraSelectors}` : EDITABLE_SELECTOR;
  return node.closest(selector) != null;
}

export function isInsideGrid(
  target: EventTarget | null,
  active: Element | null,
  wrap?: HTMLElement | null,
  gridSelector: string = GRID_SELECTOR
): boolean {
  const node = target as Element | null;
  if (node?.closest?.(GRID_KEYBOARD_SUPPRESS_SELECTOR) != null) return false;
  if (active?.closest?.(GRID_KEYBOARD_SUPPRESS_SELECTOR) != null) return false;
  if (wrap && node && wrap.contains(node)) return true;
  if (wrap && active && wrap.contains(active)) return true;
  if (node?.closest?.(gridSelector) != null) return true;
  return active?.closest?.(gridSelector) != null;
}
