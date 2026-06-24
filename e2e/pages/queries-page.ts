import { type Locator, type Page } from '@playwright/test';

/** The sidebar "Queries" view: saved queries and query history. */
export class QueriesPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async open(): Promise<void> {
    await this.showSaved();
  }

  async showSaved(): Promise<void> {
    await this.page.locator('.sidebar-tabs').getByRole('button', { name: 'Saved' }).click();
  }

  async showHistory(): Promise<void> {
    await this.page.locator('.sidebar-tabs').getByRole('button', { name: 'Recent' }).click();
  }

  savedItem(name: string): Locator {
    return this.page.locator('.sidebar-list .sidebar-entry-title', { hasText: name });
  }

  historyItem(sqlFragment: string): Locator {
    return this.page.locator('.sidebar-list .sidebar-entry-sql', { hasText: sqlFragment });
  }

  // ── Filtering ──────────────────────────────────────────────────────────────
  get savedFilter(): Locator {
    return this.page.getByPlaceholder('Filter saved queries');
  }

  get historyFilter(): Locator {
    return this.page.getByPlaceholder('Filter history');
  }

  async filterSaved(text: string): Promise<void> {
    await this.savedFilter.fill(text);
  }

  async filterHistory(text: string): Promise<void> {
    await this.historyFilter.fill(text);
  }

  // ── Filter popover (scope + sort for Saved; scope + clear for Recent) ────────
  get filterMenuButton(): Locator {
    return this.page.getByTestId('filter-menu');
  }

  /** Pick a saved-query sort from the filter popover: "Name", "Updated" or "Created". */
  async sortBy(option: 'Name' | 'Updated' | 'Created'): Promise<void> {
    await this.filterMenuButton.click();
    await this.page.getByRole('menuitem', { name: option, exact: true }).click();
  }

  /** Saved-query titles in their listed (post-sort) order. */
  async savedTitlesInOrder(): Promise<string[]> {
    return this.page
      .locator('.sidebar-list .sidebar-entry-title')
      .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
  }

  // ── Scope (lives in the filter popover; pick the connection / all menu item) ─
  async setScope(name: 'This connection' | 'All connections'): Promise<void> {
    await this.filterMenuButton.click();
    await this.page.getByRole('menuitem', { name, exact: true }).click();
  }

  async setSavedScope(name: 'This connection' | 'All connections'): Promise<void> {
    await this.setScope(name);
  }

  async setHistoryScope(name: 'This connection' | 'All connections'): Promise<void> {
    await this.setScope(name);
  }

  // ── Saved-query actions (Queries → Saved) ──────────────────────────────────
  /** A saved-query list row (carries the title + hover actions), matched by name. */
  savedRow(name: string): Locator {
    return this.page.locator('.sidebar-list .history-item', { hasText: name });
  }

  /** Click a saved query to open/focus its editor tab. */
  async openSaved(name: string): Promise<void> {
    await this.savedRow(name).click();
  }

  async renameSaved(name: string, newName: string): Promise<void> {
    const row = this.savedRow(name);
    await row.hover();
    await row.locator('[data-tooltip="Rename saved query"]').click();
    const dialog = this.page.getByRole('dialog');
    await dialog.locator('#rename-query-input').fill(newName);
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
    await this.page.locator('.modal-overlay').waitFor({ state: 'hidden' });
  }

  async deleteSaved(name: string): Promise<void> {
    const row = this.savedRow(name);
    await row.hover();
    await row.locator('[data-tooltip="Delete saved query"]').click();
    await this.page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  }

  async pinSaved(name: string): Promise<void> {
    const row = this.savedRow(name);
    await row.hover();
    await row.locator('[data-tooltip="Pin"]').click();
  }

  // ── History actions (Queries → Recent) ─────────────────────────────────────
  /** A history list row, matched by an SQL fragment. */
  historyRow(sqlFragment: string): Locator {
    return this.page.locator('.sidebar-list .history-item', { hasText: sqlFragment }).first();
  }

  /** Click a history entry to load its SQL into the editor (does not auto-run). */
  async openHistory(sqlFragment: string): Promise<void> {
    await this.historyRow(sqlFragment).click();
  }

  /** Delete a single history entry (immediate, no confirm). */
  async deleteHistory(sqlFragment: string): Promise<void> {
    const row = this.historyRow(sqlFragment);
    await row.hover();
    await row.locator('[data-tooltip="Delete from history"]').click();
  }

  /** Clear all history for the current scope via the filter popover (confirms the dialog). */
  async clearAllHistory(): Promise<void> {
    await this.filterMenuButton.click();
    await this.page.getByRole('menuitem', { name: 'Clear all', exact: true }).click();
    await this.page.getByRole('alertdialog').getByRole('button', { name: 'Clear history' }).click();
  }
}
