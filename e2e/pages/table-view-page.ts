import { expect, type Locator, type Page } from '@playwright/test';

/** The data-browser table view (opened from the schema browser). */
export class TableViewPage {
  readonly page: Page;
  readonly pane: Locator;
  readonly grid: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pane = page.locator('.table-view-pane');
    this.grid = this.pane.locator('.table-view-grid');
  }

  async waitForRows(): Promise<void> {
    await expect(this.pane).toBeVisible();
    const firstCell = this.grid.locator('td[id^="tableview-cell-"]').first();
    // In Wails server mode the WebSocket broadcaster writes each event on its own
    // goroutine, so the table view's streamed rows can arrive out of order; when the
    // terminal result wins that race the grid keeps the (empty) page for that stream.
    // A refresh starts a fresh stream, so retry a few times. (Production uses ordered
    // IPC and is unaffected.)
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await expect(firstCell).toBeVisible({ timeout: 8_000 });
        return;
      } catch {
        await this.pane.locator('button[data-tooltip="Refresh"]').click();
      }
    }
    await expect(firstCell).toBeVisible({ timeout: 8_000 });
  }

  cell(row: number, colIdx: number): Locator {
    return this.grid.locator(`#tableview-cell-${row}-${colIdx}`);
  }
}
