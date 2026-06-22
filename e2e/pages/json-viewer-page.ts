import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The JSON viewer side panel (toggle: Ctrl+J or View menu). Mirrors the focused results row
 * as pretty-printed JSON (first row auto-focuses on load), nesting JSON cell values as real
 * objects; "Filter keys" narrows to matching keys. Body is a read-only Monaco editor, so
 * assert on its rendered `.view-lines`.
 */
export class JsonViewerPage {
  readonly page: Page;
  readonly panel: Locator;
  readonly filterInput: Locator;
  readonly content: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.locator('.json-viewer-panel');
    this.filterInput = this.panel.locator('input.json-viewer-filter-input');
    this.content = this.panel.locator('.json-viewer-editor .view-lines');
  }

  /** Toggle the panel via the Ctrl+J shortcut. */
  async toggle(): Promise<void> {
    await this.page.keyboard.press('Control+j');
  }

  async open(): Promise<void> {
    if (await this.panel.isVisible().catch(() => false)) return;
    await this.toggle();
    await expect(this.panel).toBeVisible();
  }

  async filterKeys(text: string): Promise<void> {
    await this.filterInput.fill(text);
  }
}
