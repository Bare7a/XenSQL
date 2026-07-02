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

  /** Wait until result rows are rendered. */
  async waitForRows(): Promise<void> {
    await expect(this.grid.locator('td[data-row]').first()).toBeVisible({ timeout: 30_000 });
  }

  /** Cell text at a visual row (0-based) and column position (0-based). */
  cell(row: number, colPos: number): Locator {
    return this.grid.locator(`td[data-row="${row}"][data-col-pos="${colPos}"]`);
  }

  headerCount(): Locator {
    return this.active.locator('.results-header');
  }

  // ── Error state ────────────────────────────────────────────────────────────
  get errorCard(): Locator {
    return this.active.locator('.error-state-card');
  }

  /** Driver error-code chip (absent for cancellations). */
  get errorCode(): Locator {
    return this.active.locator('.error-state-code');
  }

  get errorMessage(): Locator {
    return this.active.locator('.error-state-message');
  }

  /** Postgres HINT line. */
  get errorHint(): Locator {
    return this.active.locator('.error-state-hint');
  }

  get jumpToErrorButton(): Locator {
    return this.errorCard.getByRole('button', { name: 'Jump to error' });
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

  // ── Selection (shares grid infrastructure with the table view) ────────────
  rownum(row: number): Locator {
    return this.grid.locator(`#result-rownum-${row}`);
  }

  header(column: string): Locator {
    return this.grid.locator(`th[data-col="${column}"]`);
  }

  /** A plain header click selects the whole column (sorting is a separate chevron). */
  async selectColumn(column: string): Promise<void> {
    await this.header(column).click();
  }

  selectedCells(): Locator {
    return this.grid.locator('td.cell-range-selected');
  }

  focusedCell(): Locator {
    return this.grid.locator('td.cell-focused');
  }

  selectedHeader(): Locator {
    return this.grid.locator('th.col-header-selected');
  }

  /** Toolbar " · {rows} × {cols} selected" indicator (only shown for multi-cell selections). */
  selectionCount(): Locator {
    return this.active.locator('.results-selection-count');
  }

  // ── Export ───────────────────────────────────────────────────────────────
  /** The "Export as" options dialog (note: "Save to file" itself uses a native dialog). */
  get exportDialog(): Locator {
    return this.page.locator('.modal').filter({ has: this.page.locator('#export-format') });
  }

  get exportFormat(): Locator {
    return this.page.locator('#export-format');
  }

  get exportRowsGroup(): Locator {
    return this.page.locator('#export-rows-group');
  }

  get exportColsGroup(): Locator {
    return this.page.locator('#export-cols-group');
  }

  get exportSummary(): Locator {
    return this.page.locator('.export-results-summary');
  }

  async openExportDialog(): Promise<void> {
    await this.active.getByRole('button', { name: 'Export as' }).click();
    await expect(this.exportDialog).toBeVisible();
  }

  async setExportFormat(value: string): Promise<void> {
    await this.exportFormat.selectOption(value);
  }

  async cancelExport(): Promise<void> {
    await this.exportDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(this.exportDialog).toBeHidden();
  }
}
