import { ALL_DATABASES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Schema & DDL', () => {
  for (const db of ALL_DATABASES) {
    test(`creates a table and shows it in the schema browser: ${db.label}`, async ({ connections, schema, seed }) => {
      await connections.createAndConnect(db);
      const table = await seed.table('e2e_schema');

      await schema.refresh();
      const row = await schema.revealTable(table);
      await expect(row).toBeVisible();

      await schema.expandColumns(table);
      await expect(schema.columnRow('id')).toBeVisible();
      await expect(schema.columnRow('name')).toBeVisible();
    });
  }
});
