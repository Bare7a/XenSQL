import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

// Postgres-only (generate_series seeds >100 rows); pagination/sort are driver-agnostic.
test.describe('Table view - pagination & sorting', () => {
  test('loads the next page when scrolled to the bottom', async ({ connections, seed, tableView }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_page', {
      columns: '(id INTEGER PRIMARY KEY, label VARCHAR(20))',
      insert: `(id, label) SELECT g, 'r' || g FROM generate_series(1, 150) g`,
    });

    // First page is 100 rows; scrolling to the bottom loads the rest.
    await expect(tableView.rowCountLabel).toContainText('100 row');
    await tableView.loadRowsUntil(150);
    await expect(tableView.rowCountLabel).toContainText('150 row');
  });

  test('sorts ascending then descending by a column', async ({ connections, seed, tableView }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_tvsort', { insert: `(id, name) VALUES (1, 'Charlie'), (2, 'Alice'), (3, 'Bob')` });

    await tableView.sortByColumn('name');
    await expect(tableView.cellAt(0, 1)).toHaveText('Alice');
    await tableView.sortByColumn('name');
    await expect(tableView.cellAt(0, 1)).toHaveText('Charlie');
  });
});
