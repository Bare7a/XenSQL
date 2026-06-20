import { expect, type Locator, type Page } from '@playwright/test';

/** The sidebar schema browser: refresh, expand schemas/tables and inspect columns. */
export class SchemaPage {
  readonly page: Page;
  readonly refreshButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.refreshButton = page.locator('.sidebar-schema-toolbar button[data-tooltip="Refresh schema"]');
  }

  async refresh(): Promise<void> {
    await this.refreshButton.click();
    await expect(this.page.getByTestId('schema-node').first()).toBeVisible({ timeout: 30_000 });
  }

  tableRow(table: string): Locator {
    return this.page.locator(`[data-testid="schema-table"][data-table="${table}"]`);
  }

  columnRow(column: string): Locator {
    return this.page.locator(`[data-testid="schema-column"][data-column="${column}"]`);
  }

  /** Expand schema nodes until the given table row is visible, then return it. */
  async revealTable(table: string): Promise<Locator> {
    const row = this.tableRow(table);
    if (await row.isVisible().catch(() => false)) return row;

    const nodes = this.page.getByTestId('schema-node');
    const count = await nodes.count();
    for (let i = 0; i < count; i++) {
      await nodes.nth(i).click();
      if (await row.isVisible().catch(() => false)) return row;
    }
    await row.waitFor({ state: 'visible' });
    return row;
  }

  /** Open the data browser (table view) for a table via its "Browse data" action. */
  async browseTable(table: string): Promise<void> {
    const row = await this.revealTable(table);
    await row.getByTestId('schema-table-browse').click();
    await this.page.locator('.table-view-pane').waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Expand a table to show its columns. */
  async expandColumns(table: string): Promise<void> {
    const row = await this.revealTable(table);
    await row.click();
  }
}
