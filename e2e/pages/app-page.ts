import { expect, type Locator, type Page } from '@playwright/test';

/** App shell: navigation, view-menu toggles (sidebar, JSON viewer) and the per-test backend reset. */
export class AppPage {
  readonly page: Page;
  readonly sidebar: Locator;
  readonly jsonViewer: Locator;
  /** The status-bar result indicator (shows "Running…", rows/affected, or an error). */
  readonly status: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebar = page.getByTestId('sidebar');
    this.jsonViewer = page.locator('.json-viewer-panel');
    this.status = page.locator('.status-bar-status');
  }

  /** Wait until a non-SELECT statement (DDL/DML) finishes - the status bar reports rows affected. */
  async expectStatementApplied(): Promise<void> {
    await expect(this.status).toContainText('affected', { timeout: 30_000 });
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.sidebar).toBeVisible({ timeout: 60_000 });
  }

  // ── View menu toggles ────────────────────────────────────────────────────
  private viewTrigger(): Locator {
    return this.page.getByRole('button', { name: 'View', exact: true });
  }

  private async toggleViaViewMenu(itemName: string): Promise<void> {
    const trigger = this.viewTrigger();
    const item = this.page.getByRole('menuitemcheckbox', { name: itemName });
    // The trigger toggles the menu, so a click can race (open then closed); retry until visible.
    for (let attempt = 0; attempt < 3 && !(await item.isVisible().catch(() => false)); attempt++) {
      await trigger.click();
      await item.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
    }
    await item.click();
    // The menu stays open after a toggle; click the trigger again to close it.
    await trigger.click();
  }

  async toggleSidebar(): Promise<void> {
    await this.toggleViaViewMenu('Toggle sidebar');
  }

  async toggleJsonViewer(): Promise<void> {
    await this.toggleViaViewMenu('Toggle JSON viewer');
  }

  // ── Test isolation ───────────────────────────────────────────────────────
  /** Reset shared backend state: the editor session (tabs) and saved connections both persist and restore on load. */
  async resetState(): Promise<void> {
    await this.closeAllTabs();
    await this.resetConnections();
  }

  /**
   * Close every editor tab, clearing the persisted session so the next test's page loads clean.
   * Runs at teardown, when this test's tabs are already rendered (nothing is restoring), so a
   * plain count-and-close suffices - no async-restore wait needed.
   */
  async closeAllTabs(): Promise<void> {
    const tabs = this.page.locator('.editor-tab');
    let count = await tabs.count();
    while (count > 0) {
      await tabs.first().locator('.close-btn').click();
      // A dirty saved-query tab confirms before closing; discard so reset can proceed.
      const discard = this.page.getByRole('button', { name: 'Discard' });
      if (await discard.isVisible().catch(() => false)) await discard.click();
      await expect(tabs).toHaveCount(count - 1);
      count -= 1;
    }
  }

  /** Delete every saved connection so each test starts from a clean backend. */
  async resetConnections(): Promise<void> {
    const switcher = this.page.getByTestId('connection-switcher');
    const menu = this.page.locator('.connection-switcher-menu');
    const items = this.page.getByTestId('connection-item');

    // Connections hydrate asynchronously after the shell renders. `connection-switcher-empty`
    // tracks connections.length (unlike the name badge, which also needs a resolvable
    // selection), so wait for that marker to clear.
    await this.page
      .waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="connection-switcher"]');
          return !!el && !el.className.includes('connection-switcher-empty');
        },
        undefined,
        { timeout: 1_500 },
      )
      .catch(() => {});
    const cls = (await switcher.getAttribute('class')) ?? '';
    if (cls.includes('connection-switcher-empty')) return;

    // The switcher toggles the menu, so retry until it is genuinely open.
    for (let attempt = 0; attempt < 3 && !(await menu.isVisible().catch(() => false)); attempt++) {
      await switcher.click();
      await menu.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
    }

    let count = await items.count();
    while (count > 0) {
      const first = items.first();
      await first.hover();
      await first.getByTestId('connection-delete').click();
      const dialog = this.page.getByRole('alertdialog');
      await dialog.getByRole('button', { name: 'Delete connection' }).click();
      await expect(items).toHaveCount(count - 1);
      count -= 1;
    }

    // Close the (now empty) menu deterministically.
    await this.page.keyboard.press('Escape');
    if (await menu.isVisible().catch(() => false)) {
      await this.page.locator('.app-title-bar-logo').click({ force: true });
    }
    await menu.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  }
}
