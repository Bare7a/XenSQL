import { ALL_DATABASES, POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Connections', () => {
  // Full add → test → save → connect → disconnect, per driver.
  for (const db of ALL_DATABASES) {
    test(`adds, tests, connects and disconnects: ${db.label}`, async ({ connections, page }) => {
      await connections.openNewDialog();
      await expect(connections.dialog).toHaveAccessibleName('New Connection');

      await connections.fillDialog(db);
      await connections.testConnectionInDialog();
      await expect(page.getByTestId('toast-success')).toContainText('Connection successful!');

      await connections.saveDialog();
      await expect(connections.switcherName).toHaveText(db.label);

      await connections.connect(db.label);
      expect(await connections.isConnected(db.label)).toBe(true);

      await connections.disconnect(db.label);
      expect(await connections.isConnected(db.label)).toBe(false);
    });
  }

  test('edits a saved connection', async ({ connections, page }) => {
    await connections.create(POSTGRES);

    await connections.openMenu();
    const item = connections.item(POSTGRES.label);
    await item.hover();
    await item.locator('[data-tooltip="Edit"]').click();

    await expect(connections.dialog).toHaveAccessibleName('Edit Connection');
    const renamed = 'E2E Postgres (edited)';
    await page.locator('#conn-name').fill(renamed);
    await connections.dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('.modal-overlay').waitFor({ state: 'hidden' });
    await connections.closeMenu();

    await expect(connections.switcherName).toHaveText(renamed);
  });

  test('deletes a connection', async ({ connections }) => {
    await connections.create(POSTGRES);
    await expect(connections.switcherName).toHaveText(POSTGRES.label);

    await connections.delete(POSTGRES.label);
    await expect(connections.switcherName).toBeHidden();
  });

  test('reorders connections by drag and drop', async ({ connections }) => {
    await connections.create({ ...POSTGRES, label: 'Conn A' });
    await connections.create({ ...POSTGRES, label: 'Conn B' });
    await connections.create({ ...POSTGRES, label: 'Conn C' });

    expect(await connections.listOrder()).toEqual(['Conn A', 'Conn B', 'Conn C']);

    // Drag first onto last → moves it to the end.
    await connections.reorder('Conn A', 'Conn C');
    expect(await connections.listOrder()).toEqual(['Conn B', 'Conn C', 'Conn A']);
  });
});
