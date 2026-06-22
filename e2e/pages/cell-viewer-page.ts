import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The rich cell-viewer modal (shared by results grid and table view). Opened with Shift+Enter
 * on a focused cell (or double-click in results). Exposes Beautify/Minify for JSON/XML/HTML, plus
 * "Set to NULL" and Save in an editable table view. Body is a Monaco editor, so assert on the
 * header line-count badge ("1 line" vs "N lines"), not the virtualized text.
 */
export class CellViewerPage {
  readonly page: Page;
  readonly modal: Locator;
  readonly lines: Locator;

  constructor(page: Page) {
    this.page = page;
    this.modal = page.locator('.cell-viewer-modal');
    this.lines = this.modal.locator('.cell-viewer-lines');
  }

  async waitForOpen(): Promise<void> {
    await expect(this.modal).toBeVisible();
  }

  /** Force the content type (so Beautify/Minify are available regardless of auto-detect). */
  async setKind(kind: 'text' | 'json' | 'xml' | 'html'): Promise<void> {
    await this.modal.locator('select.cell-viewer-kind-select').selectOption(kind);
  }

  async beautify(): Promise<void> {
    await this.modal.getByRole('button', { name: 'Beautify' }).click();
  }

  async minify(): Promise<void> {
    await this.modal.getByRole('button', { name: 'Minify' }).click();
  }

  async setNull(): Promise<void> {
    await this.modal.getByRole('button', { name: 'Set to NULL' }).click();
  }

  async save(): Promise<void> {
    await this.modal.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(this.modal).toBeHidden();
  }

  async close(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.modal).toBeHidden();
  }
}
