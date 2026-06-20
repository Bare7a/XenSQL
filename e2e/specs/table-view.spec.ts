import { expect, test } from '../fixtures';
import { ALL_DATABASES, uniqueIdent } from '../support/databases';

test.describe('Table view', () => {
  for (const db of ALL_DATABASES) {
    test(`browses table data: ${db.label}`, async ({ app, connections, editor, schema, tableView }) => {
      const t = uniqueIdent('e2e_tv');
      await connections.create(db);
      await connections.connect(db.label);

      await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
      await app.expectStatementApplied();
      await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice'), (2, 'Bob');`);
      await app.expectStatementApplied();

      await schema.refresh();
      await schema.browseTable(t);

      await tableView.waitForRows();
      await expect(tableView.pane).toContainText('Alice');
      await expect(tableView.pane).toContainText('Bob');
    });
  }
});
