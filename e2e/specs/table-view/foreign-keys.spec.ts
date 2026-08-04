import { ALL_DATABASES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Table view foreign keys', () => {
  for (const db of ALL_DATABASES) {
    test(`jumps from a foreign-key cell to the referenced row: ${db.label}`, async ({
      connections,
      seed,
      tableView,
    }) => {
      await connections.createAndConnect(db);
      const parent = await seed.table('e2e_fk_parent', { insert: `(id, name) VALUES (1, 'Alice'), (2, 'Bob')` });
      // Table-level FOREIGN KEY: MySQL silently ignores an inline column-level REFERENCES.
      await seed.browseTable('e2e_fk_child', {
        columns: `(id INTEGER PRIMARY KEY, parent_id INTEGER, FOREIGN KEY (parent_id) REFERENCES ${parent}(id))`,
        insert: `(id, parent_id) VALUES (1, 2), (2, NULL)`,
      });

      // Column position 1 is parent_id; no button on a plain column or a NULL foreign key.
      await expect(tableView.fkButton(0, 1)).toHaveCount(1);
      await expect(tableView.fkButton(0, 0)).toHaveCount(0);
      await expect(tableView.fkButton(1, 1)).toHaveCount(0);

      await tableView.jumpToForeignKey(0, 1);

      await expect(tableView.activeFilterText).toHaveText('id = 2');
      await expect(tableView.activePane.locator('tbody tr')).toHaveCount(1);
      await expect(tableView.activePane).toContainText('Bob');
    });
  }
});
