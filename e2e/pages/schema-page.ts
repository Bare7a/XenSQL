import { expect, type Locator, type Page } from '@playwright/test';

/** Mirrors the frontend's SchemaObjectGroup. */
type SchemaObjectGroup = 'indexes' | 'constraints' | 'triggers';

/** The sidebar schema browser: refresh, expand schemas/tables and inspect columns. */
export class SchemaPage {
  readonly page: Page;
  readonly refreshButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.refreshButton = page.locator('.sidebar-filter button[data-tooltip="Refresh schema"]');
  }

  async refresh(): Promise<void> {
    await this.refreshButton.click();
    await expect(this.page.getByTestId('schema-node').first()).toBeVisible({ timeout: 30_000 });
  }

  /** The schema browser search box (debounced; filters tables and columns by name). */
  get searchInput(): Locator {
    return this.page.getByPlaceholder('Search tables and columns');
  }

  async search(text: string): Promise<void> {
    await this.searchInput.fill(text);
  }

  async clearSearch(): Promise<void> {
    await this.searchInput.fill('');
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
    await row.hover();
    await row.getByTestId('schema-table-browse').click();
    await this.page.locator('.table-view-pane').waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Expand a table to show its columns. */
  async expandColumns(table: string): Promise<void> {
    const row = await this.revealTable(table);
    await row.click();
  }

  // ── Context-menu actions ───────────────────────────────────────────────────
  /** Right-click a table row to open its context menu. */
  async openTableMenu(table: string): Promise<void> {
    const row = await this.revealTable(table);
    await row.click({ button: 'right' });
    await this.page.locator('.context-menu').waitFor({ state: 'visible' });
  }

  /** Context menu → "SELECT in new tab" (opens a new tab titled with the table name). */
  async selectInNewTab(table: string): Promise<void> {
    await this.openTableMenu(table);
    await this.page.getByRole('menuitem', { name: 'SELECT in new tab' }).click();
  }

  /** Context menu → "Count rows" (opens a new "Count: {table}" tab). */
  async countRows(table: string): Promise<void> {
    await this.openTableMenu(table);
    await this.page.getByRole('menuitem', { name: 'Count rows' }).click();
  }

  /** Click a column row to insert its name into the active editor. */
  async insertColumn(column: string): Promise<void> {
    await this.columnRow(column).click();
  }

  // ── Object groups (indexes / constraints / triggers / functions) ───────────
  /** A table's group header row; the table must already be expanded. */
  groupRow(group: SchemaObjectGroup): Locator {
    return this.page.getByTestId(`schema-group-${group}`);
  }

  /** Present only once the group has been expanded. */
  groupRows(group: SchemaObjectGroup): Locator {
    return this.page.getByTestId(`schema-group-${group}-row`);
  }

  objectRow(group: SchemaObjectGroup, name: string): Locator {
    return this.page.locator(`[data-testid="schema-group-${group}-row"][data-object="${name}"]`);
  }

  /** Expand a table and one of its groups, waiting for the lazily-loaded rows. */
  async expandGroup(table: string, group: SchemaObjectGroup): Promise<void> {
    await this.expandColumns(table);
    const header = this.groupRow(group).first();
    await header.waitFor({ state: 'visible' });
    await header.click();
    // An empty group renders a placeholder instead of rows.
    await expect(this.groupRows(group).first().or(this.page.locator('.tree-children .text-muted').first())).toBeVisible(
      { timeout: 30_000 },
    );
  }

  /** Expand the schema-level Functions group. */
  async expandRoutines(): Promise<void> {
    const header = this.page.getByTestId('schema-group-routines').first();
    await header.waitFor({ state: 'visible' });
    await header.click();
  }

  // ── DDL ───────────────────────────────────────────────────────────────────
  /** Table context menu → "Copy DDL". */
  async copyTableDDL(table: string): Promise<void> {
    await this.openTableMenu(table);
    await this.page.getByRole('menuitem', { name: 'Copy DDL', exact: true }).click();
  }

  /** Table context menu → "Open DDL in new tab". */
  async openTableDDLInTab(table: string): Promise<void> {
    await this.openTableMenu(table);
    await this.page.getByRole('menuitem', { name: 'Open DDL in new tab', exact: true }).click();
  }

  /** Object-row context menu → "Copy DDL". */
  async copyObjectDDL(group: SchemaObjectGroup, name: string): Promise<void> {
    await this.objectRow(group, name).click({ button: 'right' });
    await this.page.locator('.context-menu').waitFor({ state: 'visible' });
    await this.page.getByRole('menuitem', { name: 'Copy DDL', exact: true }).click();
  }

  /** Reads the clipboard; the caller must have granted clipboard permissions. */
  async clipboardText(): Promise<string> {
    return this.page.evaluate(() => navigator.clipboard.readText());
  }
}
