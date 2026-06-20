import type { Locator, Page } from '@playwright/test';

// Playwright's mouse-based dragTo() does not trigger native HTML5 drag-and-drop
// (dragstart/dragover/drop with a shared dataTransfer), which XenSQL's connection
// reordering relies on. This dispatches those events with one DataTransfer handle
// carried across all three, so dragstart's setData() is readable in drop's getData().
export async function html5DragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
  await source.dispatchEvent('dragend', { dataTransfer });
  await dataTransfer.dispose();
}
