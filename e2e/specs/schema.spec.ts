import { expect, test } from '../fixtures';
import { ALL_DATABASES, uniqueIdent } from '../support/databases';

test.describe('Schema & DDL', () => {
  for (const db of ALL_DATABASES) {
    test(`creates a table and shows it in the schema browser: ${db.label}`, async ({
      app,
      connections,
      editor,
      schema,
    }) => {
      const table = uniqueIdent('e2e_schema');
      await connections.createAndConnect(db);

      await editor.run(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
      await app.expectStatementApplied();

      await schema.refresh();
      const row = await schema.revealTable(table);
      await expect(row).toBeVisible();

      await schema.expandColumns(table);
      await expect(schema.columnRow('id')).toBeVisible();
      await expect(schema.columnRow('name')).toBeVisible();
    });
  }
});
