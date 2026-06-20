import { expect, type Locator, type Page } from '@playwright/test';

/** The results pane: query result grid, multi-result tabs and column sorting. */
export class ResultsPage {
  readonly page: Page;
  readonly active: Locator;
  readonly grid: Locator;
  readonly resultTabs: Locator;

  constructor(page: Page) {
    this.page = page;
    this.active = page.locator('.tab-results-layer.tab-layer-active');
    this.grid = this.active.getByTestId('results-grid');
    this.resultTabs = this.active.locator('.result-tabs');
  }

  async waitForGrid(): Promise<void> {
    await expect(this.grid).toBeVisible({ timeout: 30_000 });
  }

  private async rerunActiveQuery(): Promise<void> {
    await this.page.locator('.tab-editor-layer.tab-layer-active').getByRole('button', { name: 'Run All' }).click();
  }

  /**
   * Wait until result rows are rendered. In Wails server mode the WebSocket
   * broadcaster delivers stream events without ordering guarantees, so a result's
   * row batches can lose the race to its terminal event and the grid renders no
   * rows. Re-running starts a fresh stream, so retry a few times. (Production uses
   * ordered IPC and is unaffected.)
   */
  async waitForRows(): Promise<void> {
    const firstCell = this.grid.locator('td[data-row]').first();
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await expect(firstCell).toBeVisible({ timeout: 8_000 });
        return;
      } catch {
        await this.rerunActiveQuery();
      }
    }
    await expect(firstCell).toBeVisible({ timeout: 8_000 });
  }

  /** Cell text at a visual row (0-based) and column position (0-based). */
  cell(row: number, colPos: number): Locator {
    return this.grid.locator(`td[data-row="${row}"][data-col-pos="${colPos}"]`);
  }

  headerCount(): Locator {
    return this.active.locator('.results-header');
  }

  async sortByColumn(column: string): Promise<void> {
    await this.grid.locator(`th[data-col="${column}"] .results-sort-chev`).click();
  }

  resultTab(index: number): Locator {
    return this.resultTabs.locator('.result-tab').nth(index);
  }

  async resultTabCount(): Promise<number> {
    return this.resultTabs.locator('.result-tab').count();
  }

  async selectResultTab(index: number): Promise<void> {
    await this.resultTab(index).click();
  }

  /** Focus a result row so dependent panels (e.g. the JSON viewer) update. */
  async focusRow(row: number): Promise<void> {
    await this.cell(row, 0).click();
  }
}
