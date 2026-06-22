import type { Locator, Page } from '@playwright/test';

// Playwright's mouse-based dragTo() doesn't fire native HTML5 DnD events, which
// connection reordering relies on. Dispatch them with one shared DataTransfer so
// dragstart's setData() is readable in drop's getData().
export async function html5DragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
  await source.dispatchEvent('dragend', { dataTransfer });
  await dataTransfer.dispose();
}
