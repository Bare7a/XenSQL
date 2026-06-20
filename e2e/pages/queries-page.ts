import { type Locator, type Page } from '@playwright/test';

/** The sidebar "Queries" view: saved queries and query history. */
export class QueriesPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async open(): Promise<void> {
    await this.page.locator('.sidebar-tabs').getByRole('button', { name: 'Queries' }).click();
  }

  async showSaved(): Promise<void> {
    await this.page.locator('.queries-mode').getByRole('button', { name: 'Saved' }).click();
  }

  async showHistory(): Promise<void> {
    await this.page.locator('.queries-mode').getByRole('button', { name: 'Recent' }).click();
  }

  savedItem(name: string): Locator {
    return this.page.locator('.sidebar-list .sidebar-entry-title', { hasText: name });
  }

  historyItem(sqlFragment: string): Locator {
    return this.page.locator('.sidebar-list .sidebar-entry-sql', { hasText: sqlFragment });
  }
}
