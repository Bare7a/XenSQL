import { expect, test } from '../fixtures';
import { ALL_DATABASES, uniqueIdent } from '../support/databases';

test.describe('Transactions', () => {
  for (const db of ALL_DATABASES) {
    test(`rolls back and commits: ${db.label}`, async ({ app, connections, editor, results }) => {
      const t = uniqueIdent('e2e_txn');
      await connections.create(db);
      await connections.connect(db.label);

      await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
      await app.expectStatementApplied();

      // Rollback discards the inserted row.
      await editor.beginTransaction();
      await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'temp');`);
      await app.expectStatementApplied();
      await editor.rollbackTransaction();
      await editor.run(`SELECT COUNT(*) AS c FROM ${t};`);
      await results.waitForRows();
      await expect(results.cell(0, 0)).toHaveText('0');

      // Commit persists the inserted row.
      await editor.beginTransaction();
      await editor.run(`INSERT INTO ${t} (id, name) VALUES (2, 'kept');`);
      await app.expectStatementApplied();
      await editor.commitTransaction();
      await editor.run(`SELECT COUNT(*) AS c FROM ${t};`);
      await results.waitForRows();
      await expect(results.cell(0, 0)).toHaveText('1');
    });
  }
});
