import { expect, test } from '../fixtures';
import { ALL_DATABASES, POSTGRES } from '../support/databases';

test.describe('Queries', () => {
  // A simple SELECT round-trips through the real backend for every driver.
  for (const db of ALL_DATABASES) {
    test(`runs a simple query: ${db.label}`, async ({ connections, editor, results }) => {
      await connections.create(db);
      await connections.connect(db.label);

      await editor.run('SELECT 1 AS one;');
      await results.waitForRows();
      await expect(results.cell(0, 0)).toHaveText('1');
    });
  }

  test('runs multiple statements and switches result tabs', async ({ connections, editor, results }) => {
    await connections.create(POSTGRES);
    await connections.connect(POSTGRES.label);

    await editor.run('SELECT 1 AS a; SELECT 2 AS b;');
    await results.waitForRows();
    await expect.poll(() => results.resultTabCount()).toBe(2);

    await results.selectResultTab(0);
    await expect(results.cell(0, 0)).toHaveText('1');
    await results.selectResultTab(1);
    await expect(results.cell(0, 0)).toHaveText('2');
  });

  test('runs only the selected statement', async ({ connections, editor, results }) => {
    await connections.create(POSTGRES);
    await connections.connect(POSTGRES.label);

    await editor.setSql('SELECT 7 AS sel;');
    await editor.selectAll();
    await editor.runSelection();

    await results.waitForRows();
    await expect(results.cell(0, 0)).toHaveText('7');
  });

  test('surfaces a query error', async ({ app, connections, editor }) => {
    await connections.create(POSTGRES);
    await connections.connect(POSTGRES.label);

    await editor.run('SELECT * FROM definitely_missing_table_e2e;');
    await expect(app.status).toHaveClass(/error/);
  });
});
