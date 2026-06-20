import { expect, type Locator, type Page } from '@playwright/test';
import type { DbConfig } from '../support/databases';
import { html5DragTo } from '../support/dnd';

/** Connection switcher, connection dialog and the connection list (connect / disconnect / delete / reorder). */
export class ConnectionsPage {
  readonly page: Page;
  readonly switcher: Locator;
  readonly switcherName: Locator;
  readonly dialog: Locator;

  constructor(page: Page) {
    this.page = page;
    this.switcher = page.getByTestId('connection-switcher');
    this.switcherName = page.getByTestId('connection-switcher-name');
    this.dialog = page.getByRole('dialog');
  }

  // ── Dialog ────────────────────────────────────────────────────────────────
  /**
   * True when at least one connection exists. Uses the switcher's empty marker
   * (driven by connections.length) rather than the name badge, which can be hidden
   * by a stale/unresolvable selection even when connections exist.
   */
  async hasConnections(): Promise<boolean> {
    const cls = (await this.switcher.getAttribute('class')) ?? '';
    return !cls.includes('connection-switcher-empty');
  }

  async openNewDialog(): Promise<void> {
    await this.closeMenu();
    // With connections the switcher opens a menu (pick "New connection" from it);
    // with none it opens the dialog directly.
    if (await this.hasConnections()) {
      await this.openMenu();
      await this.menu.getByRole('button', { name: 'New connection' }).click();
    } else {
      await this.switcher.click();
    }
    await this.dialog.waitFor({ state: 'visible' });
  }

  async fillDialog(cfg: DbConfig): Promise<void> {
    // Choose the driver first; switching drivers resets dependent fields.
    await this.page.locator('#conn-driver').selectOption(cfg.driver);
    await this.page.locator('#conn-name').fill(cfg.label);

    if (cfg.network) {
      await this.page.locator('#conn-host').fill(cfg.host ?? '');
      await this.page.locator('#conn-port').fill(String(cfg.port ?? ''));
      await this.page.locator('#conn-database').fill(cfg.database ?? '');
      await this.page.locator('#conn-username').fill(cfg.username ?? '');
      await this.page.locator('#conn-password').fill(cfg.password ?? '');
    } else {
      await this.page.locator('#conn-file').fill(cfg.filePath ?? '');
    }
  }

  async testConnectionInDialog(): Promise<void> {
    await this.page.getByRole('button', { name: 'Test', exact: true }).click();
  }

  async saveDialog(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await this.page.locator('.modal-overlay').waitFor({ state: 'hidden' });
  }

  /** Open the dialog, fill it for the given driver and save. */
  async create(cfg: DbConfig): Promise<void> {
    await this.openNewDialog();
    await this.fillDialog(cfg);
    await this.saveDialog();
  }

  // ── Switcher menu / list ───────────────────────────────────────────────────
  get menu(): Locator {
    return this.page.locator('.connection-switcher-menu');
  }

  // The switcher button toggles the menu, so a blind click can close an already-open
  // menu. Retry until it is actually open.
  async openMenu(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await this.menu.isVisible().catch(() => false)) return;
      await this.switcher.click();
      try {
        await this.menu.waitFor({ state: 'visible', timeout: 3_000 });
        return;
      } catch {
        // Click likely toggled a stale-open menu closed; loop and reopen.
      }
    }
    await this.menu.waitFor({ state: 'visible', timeout: 5_000 });
  }

  async closeMenu(): Promise<void> {
    if (!(await this.menu.isVisible().catch(() => false))) return;
    await this.page.keyboard.press('Escape');
    if (await this.menu.isVisible().catch(() => false)) {
      // Fallback: click a neutral element to trigger the menu's outside-click close.
      await this.page.locator('.app-title-bar-logo').click({ force: true });
    }
    await this.menu.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  }

  item(name: string): Locator {
    return this.page.locator(`[data-testid="connection-item"][data-connection-name="${name}"]`);
  }

  /** Names of the connections, in their listed order. */
  async listOrder(): Promise<string[]> {
    await this.openMenu();
    const names = await this.page.getByTestId('connection-item').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-connection-name') ?? ''),
    );
    await this.closeMenu();
    return names;
  }

  /** Connect to a saved connection; a query tab (editor) opens once it is live. */
  async connect(name: string): Promise<void> {
    await this.openMenu();
    const item = this.item(name);
    await item.hover();
    await item.getByTestId('connection-connect-toggle').click();
    await this.page
      .locator('.tab-editor-layer.tab-layer-active .monaco-editor')
      .waitFor({ state: 'visible', timeout: 60_000 });
  }

  async disconnect(name: string): Promise<void> {
    await this.openMenu();
    const item = this.item(name);
    await item.hover();
    const toggle = item.getByTestId('connection-connect-toggle');
    await expect(toggle).toHaveAttribute('data-connected', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-connected', 'false');
    await this.closeMenu();
  }

  async isConnected(name: string): Promise<boolean> {
    await this.openMenu();
    const state = await this.item(name).getByTestId('connection-connect-toggle').getAttribute('data-connected');
    await this.closeMenu();
    return state === 'true';
  }

  async delete(name: string): Promise<void> {
    await this.openMenu();
    const item = this.item(name);
    await item.hover();
    await item.getByTestId('connection-delete').click();
    const dialog = this.page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Delete connection' }).click();
    await expect(item).toHaveCount(0);
    await this.closeMenu();
  }

  /** Drag-reorder: move `fromName` onto `toName`. */
  async reorder(fromName: string, toName: string): Promise<void> {
    await this.openMenu();
    await html5DragTo(this.page, this.item(fromName), this.item(toName));
    await this.closeMenu();
  }
}
