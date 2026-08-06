import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

// The native file picker can't be driven here, so these cover the dialog only; the load itself is
// covered by internal/app/app_import_test.go.
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
});
