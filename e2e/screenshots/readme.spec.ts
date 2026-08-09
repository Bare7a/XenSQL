import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '@support/fixtures';
import { stubImportFilePicker } from '@support/importFile';
import type { SchemaPage } from '../pages/schema-page';
import { COLOR, COLOR_INDEX, FORUM, POSTGRES_DEV, POSTGRES_READONLY } from './screenshot-db';

const screenshotsDir = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(screenshotsDir, '../../.github/screenshots');

// 20 rows headed by the `public.users` columns; the dialog shows the path, so it's overridable.
const IMPORT_CSV = process.env.XENSQL_SCREENSHOT_CSV ?? path.join(screenshotsDir, 'fixtures', 'users.csv');
const IMPORT_CSV_COLUMNS = 13;

const GET_ALL_POSTS_SQL = 'SELECT * FROM posts p ORDER BY p.id;';
const PLAN_SQL = `SELECT c.name AS category, u.display_name AS author,
       COUNT(*) AS posts, SUM(p.views) AS views
FROM posts p
JOIN users u ON u.id = p.author_id
JOIN categories c ON c.id = p.category_id
WHERE p.score > 10
GROUP BY c.name, u.display_name
ORDER BY views DESC
LIMIT 25;`;
const TXN_SQL = `INSERT INTO categories
  (name, description, settings) VALUES
  ('Go', 'Talk about anything related to Go.', '{"allowLinks": true}'),
  ('TypeScript', 'Talk about anything related to TS.', '{"allowLinks": true}')
RETURNING *;

INSERT INTO categories
  (name, description, settings) VALUES
  ('Java', 'Talk about anything related to Java.', '{"allowLinks": true}'),
  ('Kotlin', 'Talk about anything related to Kotlin.', '{"allowLinks": true}')
RETURNING *;
`;

// users: id, username, email, display_name, …, preferences (pos 10)
const COL = {
  username: 1,
  displayName: 3,
  preferences: 10,
} as const;

async function capture(page: Page, fileName: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(OUT_DIR, fileName),
    type: 'png',
    animations: 'disabled',
  });
}

async function activateTab(page: Page, title: string | RegExp): Promise<void> {
  const tab = page.locator('.editor-tab', { has: page.locator('.tab-title', { hasText: title }) });
  await tab.click();
  await expect(tab).toHaveClass(/active/);
}

async function openViewMenu(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'View', exact: true });
  const themeSwitch = page.getByRole('switch');
  for (let attempt = 0; attempt < 3 && !(await themeSwitch.isVisible().catch(() => false)); attempt++) {
    await trigger.click();
    await themeSwitch.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
  }
  await expect(themeSwitch).toBeVisible();
}

/** Inject a styled format menu that matches the native dropdown look in the README shots. */
async function showFormatMenu(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('screenshot-format-menu')?.remove();
    const sel = document.querySelector(
      '.table-view-layer.tab-layer-active select.results-format-select',
    ) as HTMLSelectElement | null;
    if (!sel) throw new Error('format select not found');
    const rect = sel.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'screenshot-format-menu';
    menu.setAttribute('role', 'listbox');
    Object.assign(menu.style, {
      position: 'fixed',
      top: `${rect.bottom + 2}px`,
      left: `${rect.left}px`,
      minWidth: `${Math.max(rect.width, 120)}px`,
      zIndex: '10000',
      background: 'var(--bg-elevated, #252526)',
      border: '1px solid var(--border, #3c3c3c)',
      borderRadius: '4px',
      boxShadow: '0 4px 16px rgba(0,0,0,.45)',
      padding: '4px 0',
      fontSize: '12px',
      color: 'var(--text, #ccc)',
      fontFamily: 'inherit',
    });
    const labels = ['Text', 'CSV', 'JSON', 'Markdown', 'SQL INSERT'];
    for (const label of labels) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 10px',
        cursor: 'default',
        background: label === 'CSV' ? 'var(--accent, #3b82f6)' : 'transparent',
        color: label === 'CSV' ? '#fff' : 'inherit',
      });
      const check = document.createElement('span');
      check.textContent = label === 'CSV' ? '✓' : '';
      check.style.width = '12px';
      row.appendChild(check);
      row.appendChild(document.createTextNode(label));
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
  });
}

async function hideFormatMenu(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('screenshot-format-menu')?.remove());
}

/** Paste SQL (avoids Monaco treating `{` / quotes as snippets while typing). */
async function pasteSql(page: Page, sql: string): Promise<void> {
  const monaco = page.locator('.tab-editor-layer.tab-layer-active .monaco-editor').first();
  await monaco.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, sql);
  await page.keyboard.press('ControlOrMeta+V');
  await page.keyboard.press('Escape');
}

async function runPastedSql(page: Page, editor: { runAll: () => Promise<void> }, sql: string): Promise<void> {
  await pasteSql(page, sql);
  await editor.runAll();
}

/** Demo settings: one UI Zoom step (default 100% → 108%). Leaves editor font size alone. */
async function applyDemoZoom(page: Page): Promise<void> {
  await openViewMenu(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByText('108%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('switch')).toBeHidden();
}

/** Demo settings.json: sidebar 364px, JSON viewer 410px (defaults are 280 / 320). */
async function applyDemoPanelWidths(page: Page): Promise<void> {
  const SIDEBAR = 364;
  const JSON_W = 410;

  const dragVerticalHandle = async (handle: ReturnType<Page['locator']>, deltaX: number) => {
    const box = await handle.boundingBox();
    if (!box) throw new Error('resize handle not visible');
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(box.height / 2, 80);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y, { steps: 12 });
    await page.mouse.up();
  };

  const sidebar = page.locator('.sidebar-shell');
  const json = page.locator('.json-viewer-shell');
  await expect(sidebar).toBeVisible();
  await expect(json).toBeVisible();

  const sidebarW = (await sidebar.boundingBox())?.width ?? 0;
  if (Math.abs(sidebarW - SIDEBAR) > 4) {
    await dragVerticalHandle(page.locator('.panel-resize-handle-vertical').first(), SIDEBAR - sidebarW);
  }
  const jsonW = (await json.boundingBox())?.width ?? 0;
  if (Math.abs(jsonW - JSON_W) > 4) {
    // JSON panel edge is 'left': drag left to widen.
    await dragVerticalHandle(page.locator('.panel-resize-handle-vertical').last(), -(JSON_W - jsonW));
  }
}

/** Drag the editor/results splitter; the app's default is 40%. */
async function setResultsSplit(page: Page, percent: number): Promise<void> {
  const area = await page.locator('.main-area').boundingBox();
  const handle = await page.locator('.resizer').boundingBox();
  if (!area || !handle) throw new Error('results splitter not visible');
  const x = handle.x + handle.width / 2;
  await page.mouse.move(x, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, area.y + area.height * (1 - percent / 100), { steps: 12 });
  await page.mouse.up();
}

/** expandColumns toggles - only click when columns are not already visible. */
async function ensureUsersExpanded(schema: SchemaPage): Promise<void> {
  const username = schema.columnRow('username').first();
  // SchemaPanel debounces search by 200ms. The input can be empty while the tree
  // is still filtered - clicking then toggles an already-expanded table shut.
  await schema.page.waitForTimeout(350);
  if (await username.isVisible().catch(() => false)) return;
  await schema.expandColumns('users');
  await expect(username).toBeVisible();
}

/** Wait until Monaco has painted syntax tokens (avoids all-white JSON in the cell viewer). */
async function waitForCellViewerSyntax(page: Page): Promise<void> {
  const modal = page.locator('.cell-viewer-modal');
  await expect(modal.locator('.cell-viewer-lines')).toContainText(/\d+ lines?/);
  const token = modal.locator('.cell-viewer-monaco span[class^="mtk"]').first();
  await expect(token).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => token.evaluate((el) => getComputedStyle(el).color), { timeout: 15_000 })
    .not.toBe('rgb(255, 255, 255)');
  await page.waitForTimeout(250);
}

async function createFolder(page: Page, name: string): Promise<void> {
  // Assumes the connection switcher menu is already open.
  await page.locator('.sidebar-connections-toolbar button[data-tooltip="New folder"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('#app-dialog-prompt-input').fill(name);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.modal-overlay').waitFor({ state: 'hidden' });
}

async function moveConnectionToFolder(page: Page, connName: string, folderName: string): Promise<void> {
  const item = page.locator(`[data-testid="connection-item"][data-connection-name="${connName}"]`).first();
  await item.click({ button: 'right' });
  await page.locator('.context-menu').waitFor({ state: 'visible' });
  await page.getByRole('menuitem', { name: `Move to: ${folderName}` }).click();
}

test.describe('README screenshots', () => {
  test.describe.configure({ mode: 'serial' });

  test('capture 1–12 into .github/screenshots', async ({
    page,
    connections,
    editor,
    results,
    plan,
    schema,
    queries,
    tableView,
    jsonViewer,
    cellViewer,
    tabs,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // ── Shared workspace (matches Demo/1-XenSQL-data) ──────────────────────
    // 1) Red readonly Postgres → "Query 1 - Postgres"
    await connections.createAndConnect({
      ...POSTGRES_READONLY,
      color: COLOR.red,
      readOnly: true,
    });
    // 2) Green Forum → "Query 1 - Forum"
    await connections.createAndConnect({
      ...FORUM,
      color: COLOR.green,
    });
    await expect(editor.monaco).toBeVisible();
    await page.waitForTimeout(1_000);

    // Keep "Query 1 - Forum": open a fresh Forum tab for the saved query.
    await page.keyboard.press('Control+t');
    await expect(tabs.activeTitle).toContainText(/Query \d+/);
    await editor.run(GET_ALL_POSTS_SQL);
    await results.waitForRows();
    await editor.saveQueryToLibrary('Get All Posts');
    await expect(page.locator('.editor-tab.active .tab-title')).toHaveText('Get All Posts');

    await schema.browseTable('users');
    await tableView.waitForRows();
    await ensureUsersExpanded(schema);
    await jsonViewer.open();
    await applyDemoPanelWidths(page);

    // Intentionally Disabled
    // await applyDemoZoom(page);

    // Sanity: tab colors / order
    await expect(page.locator('.editor-tab').nth(0).locator('.tab-title')).toHaveText('Query 1 - Postgres');
    await expect(page.locator('.editor-tab').nth(0)).toHaveClass(/read-only-tab/);

    // ── 1.png - Editor ─────────────────────────────────────────────────────
    await activateTab(page, 'Get All Posts');
    await queries.showSaved();
    await results.focusRow(0);
    await editor.setSql('SELECT * FROM posts p ORDER BY p.');
    await editor.triggerSuggestions();
    await expect(editor.suggestWidget).toBeVisible();
    await expect(editor.suggestWidget.locator('.monaco-list-row').first()).toBeVisible();
    await capture(page, '1.png');
    await page.keyboard.press('Escape');
    // Restore saved SQL so the tab isn't left dirty (yellow) in later shots.
    await pasteSql(page, GET_ALL_POSTS_SQL);

    // ── 2.png - Transactions & multiple results ────────────────────────────
    await page.keyboard.press('Control+t');
    await expect(tabs.activeTitle).toContainText(/Query \d+/);
    await editor.beginTransaction();
    await runPastedSql(page, editor, TXN_SQL);
    await results.waitForRows();
    await expect(results.resultTabs.locator('.result-tab')).toHaveCount(2);
    await results.selectResultTab(1);
    await results.focusRow(0);
    await page.locator('.sidebar-tabs').getByRole('button', { name: 'Schema' }).click();
    await capture(page, '2.png');
    await editor.rollbackTransaction();
    // Close the txn tab so later shots match the 4-tab Demo layout.
    await tabs.closeActiveWithKeyboard();

    // ── 3.png - Table data (schema search "id" + JSON filter "la") ──────────
    await activateTab(page, 'users');
    await tableView.waitForRows();
    await schema.search('id');
    await expect(schema.columnRow('id').first()).toBeVisible();
    // Pending edit + deletes first (do not Apply - marketing shot).
    await tableView.editCell(3, COL.username, 'maria_young82');
    await tableView.markRowForDelete(5);
    await tableView.markRowForDelete(6);
    await expect(tableView.pendingUpdates).toContainText('1');
    await expect(tableView.pendingDeletes).toContainText('2');
    await tableView.focusCell(0, COL.displayName);
    await jsonViewer.filterKeys('la');
    await expect(jsonViewer.content).toContainText('display_name', { timeout: 10_000 });
    await expect(jsonViewer.content).toContainText('last_seen_at');
    // Filter autocomplete last so the suggest widget stays visible in the shot.
    await tableView.filterEditor.click();
    await page.keyboard.type('id < 20 AND di', { delay: 40 });
    await page.keyboard.press('Control+Space');
    await expect(editor.suggestWidget).toBeVisible();
    await expect(editor.suggestWidget).toContainText('display_name');
    await page.waitForTimeout(300);
    await capture(page, '3.png');
    await page.keyboard.press('Escape');
    await jsonViewer.filterKeys('');
    await schema.clearSearch();
    await tableView.reset();
    await tableView.filterEditor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Escape');

    // ── 4.png - Cell editor ────────────────────────────────────────────────
    await page.locator('.sidebar-tabs').getByRole('button', { name: 'Schema' }).click();
    await ensureUsersExpanded(schema);
    const prefCell = tableView.cellAt(32, COL.preferences);
    await prefCell.scrollIntoViewIfNeeded();
    await tableView.openCellViewer(32, COL.preferences);
    await cellViewer.waitForOpen();
    await cellViewer.setKind('json');
    await cellViewer.beautify();
    await waitForCellViewerSyntax(page);
    await capture(page, '4.png');
    await cellViewer.close();

    // ── 5.png - Grid selection + format menu ───────────────────────────────
    // Shot 4 scrolled to preferences; reset scroll so id is visible and the
    // selection clearly spans username → display_name (README original).
    await tableView.scroll.evaluate((el) => {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    });
    await ensureUsersExpanded(schema);
    await tableView.cellAt(4, COL.username).click();
    await tableView.cellAt(17, COL.displayName).click({ modifiers: ['Shift'] });
    await expect(tableView.selectionCount()).toContainText('14');
    await expect(tableView.selectionCount()).toContainText('3');
    await showFormatMenu(page);
    await capture(page, '5.png');
    await hideFormatMenu(page);

    // ── 6.png - Export dialog ──────────────────────────────────────────────
    await tableView.activePane.getByRole('button', { name: 'Export', exact: true }).click();
    const exportDialog = page.locator('.modal').filter({ has: page.locator('#export-format') });
    await expect(exportDialog).toBeVisible();
    await page.locator('#export-format').selectOption('csv');
    const selectedRows = page.locator('#export-rows-group').getByRole('button', { name: /Selected/ });
    const selectedCols = page.locator('#export-cols-group').getByRole('button', { name: /Selected/ });
    await expect(selectedRows).toBeEnabled();
    await selectedRows.click();
    await expect(selectedCols).toBeEnabled();
    await selectedCols.click();
    await expect(page.locator('.export-results-summary')).toContainText('CSV');
    await capture(page, '6.png');
    await exportDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(exportDialog).toBeHidden();

    // ── 7.png - New connection over grouped connections ────────────────────
    // Match Demo/4-XenSQL-data: Development{Forum, Postgres blue} + Production{Postgres red}.
    await connections.openMenu();
    await createFolder(page, 'Development');
    await createFolder(page, 'Production');
    // Blue Postgres under Development (not connected).
    await connections.menu.getByRole('button', { name: 'New connection' }).click();
    await connections.dialog.waitFor({ state: 'visible' });
    await connections.fillDialog({ ...POSTGRES_DEV, color: COLOR.blue });
    await connections.saveDialog();
    await connections.openMenu();
    // Move: Forum → Development; connected (red) Postgres → Production; other → Development.
    await moveConnectionToFolder(page, 'Forum', 'Development');
    const postgresConnected = page
      .locator('[data-testid="connection-item"][data-connection-name="Postgres"]')
      .filter({ has: page.locator('[data-testid="connection-connect-toggle"][data-connected="true"]') });
    const postgresIdle = page
      .locator('[data-testid="connection-item"][data-connection-name="Postgres"]')
      .filter({ has: page.locator('[data-testid="connection-connect-toggle"][data-connected="false"]') });
    await postgresConnected.click({ button: 'right' });
    await page.locator('.context-menu').waitFor({ state: 'visible' });
    await page.getByRole('menuitem', { name: 'Move to: Production' }).click();
    await postgresIdle.click({ button: 'right' });
    await page.locator('.context-menu').waitFor({ state: 'visible' });
    await page.getByRole('menuitem', { name: 'Move to: Development' }).click();

    // Open New Connection while leaving the switcher menu open (modal ignores outside-click).
    await connections.menu.getByRole('button', { name: 'New connection' }).click();
    await connections.dialog.waitFor({ state: 'visible' });
    await connections.fillDialog({
      key: 'postgres',
      label: 'My Database',
      driver: 'postgres',
      network: true,
      host: 'localhost',
      port: 5432,
      database: 'blog',
      username: 'postgres',
      password: '',
      color: COLOR.blue,
      readOnly: true,
    });
    await page.locator('.color-swatch').nth(COLOR_INDEX.blue).click();
    await expect(connections.dialog).toBeVisible();
    await expect(connections.menu).toBeVisible();
    await capture(page, '7.png');
    await connections.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('.modal-overlay').waitFor({ state: 'hidden' });
    await connections.closeMenu();

    // ── 8.png - Quick Search ───────────────────────────────────────────────
    await page.keyboard.press('Control+p');
    const quickSearch = page.locator('.quick-search-dialog');
    await expect(quickSearch).toBeVisible();
    const usersItem = quickSearch.locator('.quick-search-item', { hasText: 'users' }).first();
    await expect(usersItem).toBeVisible();
    for (let i = 0; i < 8; i++) {
      if (await usersItem.evaluate((el) => el.classList.contains('active')).catch(() => false)) break;
      await page.keyboard.press('ArrowDown');
    }
    await capture(page, '8.png');
    await page.keyboard.press('Escape');
    await expect(quickSearch).toBeHidden();

    // ── 9.png - DDL viewer + the deeper schema tree ────────────────────────
    // The JSON viewer only mirrors grid rows: dead space next to an editor-only tab.
    await jsonViewer.toggle();
    await expect(jsonViewer.panel).toBeHidden();
    await activateTab(page, 'users');
    await ensureUsersExpanded(schema);
    await schema.expandGroup('users', 'indexes');
    await expect(schema.objectRow('indexes', 'users_pkey')).toBeVisible();
    await schema.expandGroup('users', 'constraints');
    await expect(schema.objectRow('constraints', 'users_pkey')).toBeVisible();
    await schema.openTableDDLInTab('users');
    await expect(tabs.activeTitle).toContainText('DDL: users');
    await expect(editor.active.locator('.view-lines')).toContainText('CREATE TABLE');
    // A DDL tab has no results.
    await setResultsSplit(page, 15);
    await capture(page, '9.png');
    await tabs.closeActiveWithKeyboard();

    // ── 10.png - Plan viewer (EXPLAIN ANALYZE) ─────────────────────────────
    await activateTab(page, 'users');
    await page.keyboard.press('Control+t');
    await expect(tabs.activeTitle).toContainText(/Query \d+/);
    await pasteSql(page, PLAN_SQL);
    await plan.explainAnalyze();
    await expect(plan.badge).toHaveText('Measured');
    await setResultsSplit(page, 58);
    // Metrics can tie for hottest; the deepest of them has the richest details.
    await plan.view.locator('.plan-row-hottest .plan-node-btn').last().click();
    await expect(plan.detailsTitle).toBeVisible();
    await capture(page, '10.png');
    // Back to the demo layout.
    await setResultsSplit(page, 40);
    await tabs.closeActiveWithKeyboard();

    // ── 11.png - CSV / SQL importer (loaded, never run) ────────────────────
    await jsonViewer.open();
    await stubImportFilePicker(page, IMPORT_CSV);
    await schema.openTableMenu('users');
    await page.getByRole('menuitem', { name: 'Import into this table…' }).click();
    const importDialog = page.getByRole('dialog');
    await expect(importDialog).toBeVisible();
    await expect(importDialog.getByLabel('Table')).toHaveValue('users');
    await importDialog.getByRole('button', { name: 'Browse' }).click();
    await expect(importDialog.locator('#import-path')).toHaveValue(IMPORT_CSV);
    await expect(importDialog.locator('.import-map-table tbody tr')).toHaveCount(IMPORT_CSV_COLUMNS);
    await expect(importDialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
    await capture(page, '11.png');
    await importDialog.locator('.modal-footer').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(importDialog).toBeHidden();
    await page.unroute('**/wails/runtime');

    // ── 12.png - Appearance (light theme + View menu) ──────────────────────
    await openViewMenu(page);
    const themeSwitch = page.getByRole('switch');
    if ((await themeSwitch.getAttribute('aria-checked')) === 'true') {
      await themeSwitch.click();
    }

    await capture(page, '12.png');
  });
});
