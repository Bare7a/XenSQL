import { expect, test } from '../fixtures';
import { POSTGRES, uniqueIdent } from '../support/databases';

// Postgres-only (generate_series seeds >100 rows); pagination/sort are driver-agnostic.
test.describe('Table view - pagination & sorting', () => {
  test('loads the next page when scrolled to the bottom', async ({ app, connections, editor, schema, tableView }) => {
    const t = uniqueIdent('e2e_page');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, label VARCHAR(20));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, label) SELECT g, 'r' || g FROM generate_series(1, 150) g;`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();

    // First page is 100 rows; scrolling to the bottom loads the rest.
    await expect(tableView.rowCountLabel).toContainText('100 row');
    await tableView.loadRowsUntil(150);
    await expect(tableView.rowCountLabel).toContainText('150 row');
  });

  test('sorts ascending then descending by a column', async ({ app, connections, editor, schema, tableView }) => {
    const t = uniqueIdent('e2e_tvsort');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Charlie'), (2, 'Alice'), (3, 'Bob');`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();

    await tableView.sortByColumn('name');
    await expect(tableView.cellAt(0, 1)).toHaveText('Alice');
    await tableView.sortByColumn('name');
    await expect(tableView.cellAt(0, 1)).toHaveText('Charlie');
  });
});
