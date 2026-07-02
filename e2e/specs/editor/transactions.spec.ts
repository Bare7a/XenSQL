import { ALL_DATABASES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Transactions', () => {
  for (const db of ALL_DATABASES) {
    test(`rolls back and commits: ${db.label}`, async ({ app, connections, editor, results, seed }) => {
      await connections.createAndConnect(db);
      const t = await seed.table('e2e_txn');

      // Rollback discards the insert.
      await editor.beginTransaction();
      await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'temp');`);
      await app.expectStatementApplied();
      await editor.rollbackTransaction();
      await editor.run(`SELECT COUNT(*) AS c FROM ${t};`);
      await results.waitForRows();
      await expect(results.cell(0, 0)).toHaveText('0');

      // Commit persists the insert.
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
