import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The data-browser table view (opened from the schema browser): cell/row/column selection,
 * inline editing, set-null, mark-for-delete, reset/apply, undo/redo, the rich cell viewer,
 * sorting and scroll pagination.
 *
 * Selection / pending state is class-driven, no aria (`cell-focused`, `cell-range-selected`,
 * `col-header-selected`, `cell-pending-edit`, `row-pending-delete`, `null-val`). Position
 * lookups use `data-row`/`data-col-pos`, since the cell id uses original indices that diverge
 * once columns are hidden.
 */
export class TableViewPage {
  readonly page: Page;
  readonly pane: Locator;
  readonly grid: Locator;
  /** The virtualized scroll container (drives load-more pagination). */
  readonly scroll: Locator;
  readonly applyButton: Locator;
  readonly resetButton: Locator;
  readonly refreshButton: Locator;
  readonly cellInput: Locator;
  /** Footer pending-change tallies ("N to update" / "N to delete"). */
  readonly pendingUpdates: Locator;
  readonly pendingDeletes: Locator;
  /** Toolbar "{n} row(s) loaded" indicator. */
  readonly rowCountLabel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pane = page.locator('.table-view-pane');
    this.grid = this.pane.locator('.table-view-grid');
    this.scroll = this.pane.locator('.table-view-table-wrap');
    this.applyButton = this.pane.locator('button.table-view-apply-btn');
    this.resetButton = this.pane.getByRole('button', { name: 'Reset', exact: true });
    this.refreshButton = this.pane.locator('button[data-tooltip="Refresh"]');
    this.cellInput = this.pane.locator('input.table-view-cell-input');
    this.pendingUpdates = this.pane.locator('.table-view-pending-stat--update');
    this.pendingDeletes = this.pane.locator('.table-view-pending-stat--delete');
    this.rowCountLabel = this.pane.locator('.results-header > span').first();
  }

  async waitForRows(): Promise<void> {
    await expect(this.pane).toBeVisible();
    await expect(this.grid.locator('td[id^="tableview-cell-"]').first()).toBeVisible({ timeout: 30_000 });
  }

  // ── Cells / rows / headers ───────────────────────────────────────────────
  /** Cell by on-screen position (survives sorting). */
  cellAt(row: number, colPos: number): Locator {
    return this.grid.locator(`td[data-row="${row}"][data-col-pos="${colPos}"]`);
  }

  rownum(row: number): Locator {
    return this.grid.locator(`#tableview-rownum-${row}`);
  }

  header(column: string): Locator {
    return this.grid.locator(`th[data-col="${column}"]`);
  }

  // ── Selection ────────────────────────────────────────────────────────────
  async focusCell(row: number, colPos: number): Promise<void> {
    await this.cellAt(row, colPos).click();
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

  /** Toolbar selection indicator (" · {rows} × {cols} selected"); shown only for multi-cell selections. */
  selectionCount(): Locator {
    return this.pane.locator('.results-selection-count');
  }

  // ── Editing / null / delete ──────────────────────────────────────────────
  /** Double-click to open the inline editor, replace the value and commit with Enter. */
  async editCell(row: number, colPos: number, value: string): Promise<void> {
    await this.cellAt(row, colPos).dblclick();
    await this.cellInput.waitFor({ state: 'visible' });
    await this.cellInput.fill(value);
    await this.cellInput.press('Enter');
  }

  /** Focus a cell and set it to NULL via Ctrl+Delete. */
  async setCellNull(row: number, colPos: number): Promise<void> {
    await this.focusCell(row, colPos);
    await this.page.keyboard.press('Control+Delete');
  }

  /** Mark a row for deletion (double-click its row-number gutter cell). */
  async markRowForDelete(row: number): Promise<void> {
    await this.rownum(row).dblclick();
  }

  // ── Reset / apply / undo / redo ──────────────────────────────────────────
  async apply(): Promise<void> {
    await this.applyButton.click();
    // Wait for the pending tallies to clear, not the button to disable: it disables the instant
    // `applying` starts, before the write completes, so tallies==0 means committed.
    await expect(this.pendingUpdates).toHaveCount(0, { timeout: 30_000 });
    await expect(this.pendingDeletes).toHaveCount(0, { timeout: 30_000 });
  }

  async reset(): Promise<void> {
    await this.resetButton.click();
    await expect(this.resetButton).toBeDisabled();
  }

  async refresh(): Promise<void> {
    // Refresh is disabled while a load is in flight (e.g. just after apply()'s refetch);
    // wait for it to settle so we don't block on a disabled button until the test timeout.
    await expect(this.refreshButton).toBeEnabled({ timeout: 30_000 });
    await this.refreshButton.click();
    await this.waitForRows();
  }

  /** Undo the last pending change (Ctrl+Z); a grid cell must hold focus first. */
  async undo(): Promise<void> {
    await this.page.keyboard.press('Control+z');
  }

  /** Redo (Ctrl+Shift+Z); a grid cell must hold focus first. */
  async redo(): Promise<void> {
    await this.page.keyboard.press('Control+Shift+z');
  }

  // ── Rich cell viewer (JSON/text) ─────────────────────────────────────────
  /** Focus a cell and open the rich cell viewer modal with Shift+Enter. */
  async openCellViewer(row: number, colPos: number): Promise<void> {
    await this.focusCell(row, colPos);
    await this.page.keyboard.press('Shift+Enter');
  }

  // ── Sorting / pagination ─────────────────────────────────────────────────
  async sortByColumn(column: string): Promise<void> {
    await this.header(column).locator('button.results-sort-chev').click();
    await this.waitForRows();
  }

  /** Scroll the grid to the bottom to trigger the next 100-row page load. */
  async scrollToBottom(): Promise<void> {
    await this.scroll.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  }

  /** The number parsed from the "{n} row(s) loaded" toolbar indicator. */
  async loadedRowCount(): Promise<number> {
    const text = (await this.rowCountLabel.innerText()).trim();
    const match = text.match(/(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  /**
   * Scroll until at least `target` rows are loaded. Load-more fires near the bottom and the
   * next page arrives asynchronously, so poll: re-scroll until the loaded-row count catches up.
   */
  async loadRowsUntil(target: number): Promise<void> {
    await expect
      .poll(
        async () => {
          await this.scrollToBottom();
          return this.loadedRowCount();
        },
        { timeout: 30_000, intervals: [700, 1_000, 1_500] },
      )
      .toBeGreaterThanOrEqual(target);
  }

  // ── Filter ───────────────────────────────────────────────────────────────
  /** The condition input is a Monaco editor; type into it via the focused editor. */
  get filterEditor(): Locator {
    return this.pane.locator('.table-view-filter-bar .monaco-editor');
  }

  get applyFilterButton(): Locator {
    return this.pane.getByRole('button', { name: 'Apply filter' });
  }

  /** Type a WHERE condition and apply it (server-side refetch). */
  async setFilter(condition: string): Promise<void> {
    await this.filterEditor.click();
    await this.page.keyboard.type(condition);
    // Dismiss Monaco's autocomplete so it can't swallow the click.
    await this.page.keyboard.press('Escape');
    await this.applyFilterButton.click();
  }

  // ── Add row ──────────────────────────────────────────────────────────────
  get addRowButton(): Locator {
    return this.pane.locator('.table-view-footer-right button[data-tooltip="Add row"]');
  }

  /** The value input for a column in the Add-row dialog. */
  addRowInput(column: string): Locator {
    return this.page.locator(`#add-row-${column}`);
  }

  /** A column's value-source select (Default / NULL / Value) in the Add-row dialog. */
  addRowMode(column: string): Locator {
    return this.page.locator(`.table-view-add-row-mode-select[aria-label="${column} value source"]`);
  }

  async submitAddRow(): Promise<void> {
    await this.page.getByRole('button', { name: 'Insert row' }).click();
    // Dialog closes and the grid refetches on a successful insert.
    await this.page.locator('.modal-overlay').waitFor({ state: 'hidden' });
  }
}
