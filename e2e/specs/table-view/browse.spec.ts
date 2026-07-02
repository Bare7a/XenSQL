import { ALL_DATABASES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Table view', () => {
  for (const db of ALL_DATABASES) {
    test(`browses table data: ${db.label}`, async ({ connections, seed, tableView }) => {
      await connections.createAndConnect(db);
      await seed.browseTable('e2e_tv', { insert: `(id, name) VALUES (1, 'Alice'), (2, 'Bob')` });

      await expect(tableView.pane).toContainText('Alice');
      await expect(tableView.pane).toContainText('Bob');
    });
  }
});
