import fs from 'node:fs';
import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';
import { stubImportFilePicker, writeCSVFixture } from '@support/importFile';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

// The native picker is stubbed at the binding; row-level behaviour lives in app_import_test.go.
test.describe('Import dialog', () => {
  test('opens from the schema toolbar with CSV selected', async ({ connections, page }) => {
    await connections.createAndConnect(POSTGRES);

    await page.getByTestId('schema-import').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Import data');
    await expect(dialog.getByLabel('Delimiter')).toBeVisible();
    await expect(dialog.getByLabel('First row is a header')).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  });

  test('hides the CSV parse options in SQL mode', async ({ connections, page }) => {
    await connections.createAndConnect(POSTGRES);
    await page.getByTestId('schema-import').click();
    const dialog = page.getByRole('dialog');

    await dialog.getByRole('button', { name: 'SQL script' }).click();
    await expect(dialog.getByLabel('Delimiter')).toBeHidden();
    await expect(dialog.getByLabel('First row is a header')).toBeHidden();
    await expect(dialog.getByLabel(/Stop at the first error/)).toBeVisible();

    await dialog.getByRole('button', { name: 'CSV / delimited' }).click();
    await expect(dialog.getByLabel('Delimiter')).toBeVisible();
  });

  test('offers the schema’s tables as an existing target', async ({ connections, page, schema, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('e2e_import_target');
    await schema.refresh();

    await page.getByTestId('schema-import').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Existing table' }).click();
    await expect(dialog.getByLabel('Table')).toContainText(table);
    await expect(dialog.getByLabel('Delete existing rows first')).not.toBeChecked();
  });

  test('opens pre-targeted at a table from its context menu', async ({ connections, page, schema, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('e2e_import_ctx');
    await schema.refresh();

    await schema.openTableMenu(table);
    await page.getByRole('menuitem', { name: 'Import into this table…' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Table')).toHaveValue(table);
  });

  test('loads a CSV into an existing table, counting rows against the file total', async ({
    connections,
    page,
    schema,
    seed,
  }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('e2e_import_run');
    await schema.refresh();

    const rows = ['id,name'];
    for (let i = 1; i <= 1200; i++) rows.push(`${i},name${i}`);
    const csv = writeCSVFixture('people.csv', rows);
    await stubImportFilePicker(page, csv);

    await schema.openTableMenu(table);
    await page.getByRole('menuitem', { name: 'Import into this table…' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Browse' }).click();
    await expect(dialog.locator('#import-path')).toHaveValue(csv);
    await expect(dialog.locator('.import-preview-head')).toContainText('1,200 row(s)');
    await page.unroute('**/wails/runtime');

    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.locator('.task-progress')).toContainText(/Importing… [\d,]+ of 1,200 rows read/);
    // Reaching a result proves import:done landed; without it the button stays on "Importing…".
    await expect(dialog.locator('.import-result')).toContainText('Imported 1,200 row(s), skipped 0', {
      timeout: 30_000,
    });
    await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  });

  test('re-imports a CSV the export dialog produced, NULLs and formula-shaped text intact', async ({
    connections,
    editor,
    page,
    results,
    schema,
    seed,
  }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('e2e_roundtrip', { columns: '(id INT, txt TEXT, note TEXT)' });
    await editor.run(
      `INSERT INTO ${table} (id, txt, note) VALUES (1, NULL, 'plain'), (2, '', '-not a number'), (3, 'x', '=1+2');`,
    );
    await schema.refresh();

    await editor.run(`SELECT id, txt, note FROM ${table} ORDER BY id;`);
    await results.waitForRows();
    await results.openExportDialog();
    await results.setExportFormat('csv');
    const csv = (await results.copyExportToClipboard()).replace(/\r\n/g, '\n');
    expect(csv).toBe(`id,txt,note\n1,,plain\n2,"",'-not a number\n3,x,'=1+2`);

    const file = writeCSVFixture('roundtrip.csv', csv.split('\n'));
    await stubImportFilePicker(page, file);
    await schema.openTableMenu(table);
    await page.getByRole('menuitem', { name: 'Import into this table…' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Browse' }).click();
    await expect(dialog.locator('#import-path')).toHaveValue(file);
    await page.unroute('**/wails/runtime');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog.locator('.import-result')).toContainText('Imported 3 row(s), skipped 0', { timeout: 30_000 });
    await dialog.locator('.modal-footer').getByRole('button', { name: 'Close', exact: true }).click();
    fs.rmSync(file, { force: true });

    // 6 = the 3 originals plus 3 identical re-imports: NULL, '' and '=1+2' all intact.
    await editor.run(
      `SELECT COUNT(*) AS intact FROM ${table}
       WHERE (id = 1 AND txt IS NULL AND note = 'plain')
          OR (id = 2 AND txt = '' AND note = '-not a number')
          OR (id = 3 AND txt = 'x' AND note = '=1+2');`,
    );
    await results.waitForRows();
    await expect(results.grid).toContainText('6');
  });
});
