import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Schema actions', () => {
  test('opens "SELECT in new tab" and runs it', async ({ connections, editor, schema, results, seed, tabs }) => {
    await connections.createAndConnect(POSTGRES);
    const t = await seed.table('e2e_sel', { insert: `(id, name) VALUES (1, 'Alice')` });
    await schema.refresh();

    await schema.selectInNewTab(t);
    await expect(tabs.activeTitle).toContainText(t);

    await editor.runAll();
    await results.waitForRows();
    await expect(results.cell(0, 0)).toHaveText('1');
  });

  test('counts rows from the context menu', async ({ connections, editor, schema, results, seed, tabs }) => {
    await connections.createAndConnect(POSTGRES);
    const t = await seed.table('e2e_cnt', { insert: `(id, name) VALUES (1, 'Alice'), (2, 'Bob')` });
    await schema.refresh();

    await schema.countRows(t);
    await expect(tabs.activeTitle).toContainText(`Count: ${t}`);

    await editor.runAll();
    await results.waitForRows();
    await expect(results.cell(0, 0)).toHaveText('2');
  });

  test('inserts a column name into the editor', async ({ connections, editor, schema, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const t = await seed.table('e2e_col', { columns: '(id INTEGER PRIMARY KEY, distinctive_col VARCHAR(50))' });
    await schema.refresh();
    await schema.expandColumns(t);
    await editor.clear();

    await schema.insertColumn('distinctive_col');
    await expect(editor.active.locator('.view-lines')).toContainText('distinctive_col');
  });
});
