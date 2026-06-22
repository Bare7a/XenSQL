import { expect, type Locator, type Page } from '@playwright/test';

/** The SQL editor: input, run, transactions, save-to-library and autocomplete. */
export class EditorPage {
  readonly page: Page;
  /** The active editor tab layer (others stay mounted but hidden). */
  readonly active: Locator;
  readonly monaco: Locator;
  readonly txnBadge: Locator;
  readonly suggestWidget: Locator;

  constructor(page: Page) {
    this.page = page;
    this.active = page.locator('.tab-editor-layer.tab-layer-active');
    this.monaco = this.active.locator('.monaco-editor').first();
    this.txnBadge = this.active.locator('.toolbar-txn-badge');
    // Monaco renders the suggest widget at the page level (overflow widget), with `.visible` while shown.
    this.suggestWidget = page.locator('.suggest-widget.visible');
  }

  async selectAll(): Promise<void> {
    await this.monaco.click();
    await this.page.keyboard.press('ControlOrMeta+A');
  }

  /** Replace the editor contents with `sql`. */
  async setSql(sql: string): Promise<void> {
    await this.monaco.click();
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.type(sql);
    // Dismiss any autocomplete popup so it can't swallow the next interaction.
    await this.page.keyboard.press('Escape');
  }

  /** Type raw text at the cursor (no clearing) - used to exercise autocomplete. */
  async type(text: string): Promise<void> {
    await this.monaco.click();
    await this.page.keyboard.type(text);
  }

  async clear(): Promise<void> {
    await this.monaco.click();
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.press('Delete');
  }

  async runAll(): Promise<void> {
    await this.active.getByRole('button', { name: 'Run All' }).click();
  }

  async runSelection(): Promise<void> {
    await this.active.getByRole('button', { name: 'Run', exact: true }).click();
  }

  /** Set the SQL and run it. */
  async run(sql: string): Promise<void> {
    await this.setSql(sql);
    await this.runAll();
  }

  // ── Transactions ───────────────────────────────────────────────────────────
  async beginTransaction(): Promise<void> {
    await this.active.getByRole('button', { name: 'Begin Txn' }).click();
    await expect(this.txnBadge).toBeVisible();
  }

  async commitTransaction(): Promise<void> {
    await this.active.getByRole('button', { name: 'Commit' }).click();
    await expect(this.txnBadge).toBeHidden();
  }

  async rollbackTransaction(): Promise<void> {
    await this.active.getByRole('button', { name: 'Rollback' }).click();
    await expect(this.txnBadge).toBeHidden();
  }

  // ── Save to library ──────────────────────────────────────────────────────────
  async saveQueryToLibrary(name: string): Promise<void> {
    await this.active.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.locator('#app-dialog-prompt-input').fill(name);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await this.page.locator('.modal-overlay').waitFor({ state: 'hidden' });
  }

  // ── Autocomplete ─────────────────────────────────────────────────────────────
  async triggerSuggestions(): Promise<void> {
    await this.page.keyboard.press('Control+Space');
  }
}
