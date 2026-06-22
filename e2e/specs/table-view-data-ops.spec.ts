import { expect, test } from '../fixtures';
import { POSTGRES, uniqueIdent } from '../support/databases';

// `id` is column position 0, `name` is 1.
test.describe('Table view - data ops', () => {
  test('filters rows by a condition', async ({ app, connections, editor, schema, tableView }) => {
    const t = uniqueIdent('e2e_filter');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice'), (2, 'Bob');`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();
    await expect(tableView.rowCountLabel).toContainText('2 row');

    await tableView.setFilter('id = 1');
    await expect(tableView.rowCountLabel).toContainText('1 row');
    await expect(tableView.cellAt(0, 1)).toHaveText('Alice');
  });

  test('adds a row through the Add-row dialog', async ({ app, connections, editor, schema, tableView }) => {
    const t = uniqueIdent('e2e_addrow');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice');`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();
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
