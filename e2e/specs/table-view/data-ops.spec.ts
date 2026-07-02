import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

// The default seeded table: `id` is column position 0, `name` is 1.
test.describe('Table view - data ops', () => {
  test('filters rows by a condition', async ({ connections, seed, tableView }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_filter', { insert: `(id, name) VALUES (1, 'Alice'), (2, 'Bob')` });
    await expect(tableView.rowCountLabel).toContainText('2 row');

    await tableView.setFilter('id = 1');
    await expect(tableView.rowCountLabel).toContainText('1 row');
    await expect(tableView.cellAt(0, 1)).toHaveText('Alice');
  });

  test('adds a row through the Add-row dialog', async ({ connections, seed, tableView }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_addrow', { insert: `(id, name) VALUES (1, 'Alice')` });
    await expect(tableView.rowCountLabel).toContainText('1 row');

    await tableView.addRowButton.click();
    await tableView.addRowInput('id').fill('2');
    // `name` is nullable, so its source defaults to "Default"; switch to "Value".
    await tableView.addRowMode('name').selectOption('value');
    await tableView.addRowInput('name').fill('Bob');
    await tableView.submitAddRow();

    await expect(tableView.rowCountLabel).toContainText('2 row');
    await expect(tableView.grid).toContainText('Bob');
  });
});
