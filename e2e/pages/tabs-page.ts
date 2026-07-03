import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Editor tab bar: open (+ / Ctrl+T), switch (Ctrl+Tab / Ctrl+Shift+Tab) and close
 * (Ctrl+W or the per-tab ✕). Switching is a no-op with fewer than two tabs, so open a second
 * tab first. The active tab is `.editor-tab.active`.
 */
export class TabsPage {
  readonly page: Page;
  readonly tabs: Locator;
  readonly activeTab: Locator;
  /** Title element of the currently active tab. */
  readonly activeTitle: Locator;
  readonly addButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.tabs = page.locator('.editor-tab');
    this.activeTab = page.locator('.editor-tab.active');
    this.activeTitle = this.activeTab.locator('.tab-title');
    this.addButton = page.locator('.editor-tabs-add');
  }

  count(): Promise<number> {
    return this.tabs.count();
  }

  /** Open a new tab via the "+" button (with a single connection this skips the picker). */
  async newTab(): Promise<void> {
    const before = await this.count();
    await this.addButton.click();
    await expect(this.tabs).toHaveCount(before + 1);
  }

  async nextTab(): Promise<void> {
    await this.page.keyboard.press('Control+Tab');
  }

  async prevTab(): Promise<void> {
    await this.page.keyboard.press('Control+Shift+Tab');
  }

  /** Close the active tab with Ctrl+W (a clean scratch tab closes without a prompt). */
  async closeActiveWithKeyboard(): Promise<void> {
    const before = await this.count();
    await this.page.keyboard.press('Control+w');
    await expect(this.tabs).toHaveCount(before - 1);
  }

  /** Close the active tab via its ✕ button. */
  async closeActiveWithButton(): Promise<void> {
    const before = await this.count();
    await this.activeTab.getByRole('button', { name: 'Close Tab' }).click();
    await expect(this.tabs).toHaveCount(before - 1);
  }

  /** Reopen the most recently closed tab with Ctrl+Shift+T. */
  async reopenClosedTab(): Promise<void> {
    const before = await this.count();
    await this.page.keyboard.press('Control+Shift+T');
    await expect(this.tabs).toHaveCount(before + 1);
  }
}
