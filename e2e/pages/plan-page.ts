import { expect, type Locator, type Page } from '@playwright/test';

/** The query-plan viewer. It has no close action: the next run replaces it. */
export class PlanPage {
  readonly page: Page;
  readonly view: Locator;
  readonly rows: Locator;
  readonly notes: Locator;

  constructor(page: Page) {
    this.page = page;
    // Scoped to the visible set: a run's other sets stay mounted but hidden.
    this.view = page.locator('.tab-results-layer.tab-layer-active .result-set-layer.tab-layer-active .plan-view');
    this.rows = this.view.locator('.plan-row');
    this.notes = this.view.locator('.plan-note');
  }

  /** For the cases where no plan is expected. */
  async clickExplain(): Promise<void> {
    await this.page.getByRole('button', { name: 'Explain', exact: true }).click();
  }

  async explain(): Promise<void> {
    await this.clickExplain();
    await this.waitForPlan();
  }

  async explainAnalyze(): Promise<void> {
    await this.page.getByRole('button', { name: 'Explain options' }).click();
    await this.page.getByRole('menuitem', { name: 'Explain analyze' }).click();
    await this.waitForPlan();
  }

  async explainByShortcut(): Promise<void> {
    await this.page.keyboard.press('ControlOrMeta+Shift+E');
    await this.waitForPlan();
  }

  /** Left unbound on engines that can't measure. */
  async explainAnalyzeByShortcut(): Promise<void> {
    await this.page.keyboard.press('ControlOrMeta+Shift+A');
    await this.waitForPlan();
  }

  async waitForPlan(): Promise<void> {
    await expect(this.view).toBeVisible({ timeout: 30_000 });
    await expect(this.rows.first()).toBeVisible();
  }

  /** SQLite has no EXPLAIN ANALYZE, so it gets no menu. */
  async canAnalyze(): Promise<boolean> {
    return (await this.page.getByRole('button', { name: 'Explain options' }).count()) > 0;
  }

  get badge(): Locator {
    return this.view.locator('.plan-badge');
  }

  nodeLabels(): Promise<string[]> {
    return this.view.locator('.plan-node-label').allInnerTexts();
  }

  metricColumns(): Promise<string[]> {
    return this.view.locator('.plan-head-metric').allInnerTexts();
  }

  async heats(): Promise<number[]> {
    return this.rows.evaluateAll((rows) =>
      rows.map((row) => Number((row as HTMLElement).style.getPropertyValue('--plan-heat') || 0)),
    );
  }

  /** The node the heat map points at. */
  async hottestLabel(): Promise<string | null> {
    return this.view.locator('.plan-row-hottest .plan-node-label').first().textContent();
  }

  async selectNode(index: number): Promise<void> {
    await this.view.locator('.plan-node-btn').nth(index).click();
  }

  get detailsTitle(): Locator {
    return this.view.locator('.plan-details-title');
  }

  detailFields(): Promise<string[]> {
    return this.view.locator('.plan-details-grid dt').allInnerTexts();
  }

  async heatBy(metric: 'Time' | 'Cost' | 'Rows'): Promise<void> {
    await this.view.getByRole('button', { name: metric, exact: true }).click();
  }

  async toggleRaw(): Promise<void> {
    await this.view.getByRole('button', { name: 'Raw plan', exact: true }).click();
  }

  get raw(): Locator {
    return this.view.locator('.plan-raw');
  }

  async toggleFirstNode(): Promise<void> {
    await this.view.locator('.plan-twisty').first().click();
  }
}
