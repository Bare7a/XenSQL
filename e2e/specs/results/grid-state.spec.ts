import { SQLITE } from '@support/databases';
import { expect, test } from '@support/fixtures';

// Pure frontend behavior, so sqlite keeps these runnable without the container stack.
test.describe('Results - grid state', () => {
  test('keeps sort and hidden columns per result set across result-tab switches', async ({
    connections,
    editor,
    results,
    seed,
  }) => {
    await connections.createAndConnect(SQLITE);
    const t = await seed.table('e2e_sets', { insert: `(id, name) VALUES (1, 'Charlie'), (2, 'Alice'), (3, 'Bob')` });

    await editor.run(`SELECT id, name FROM ${t}; SELECT id AS num, name AS label FROM ${t};`);
    await results.waitForRows();
    await expect(results.resultTabs.locator('.result-tab')).toHaveCount(2);

    await results.sortByColumn('name');
    await expect(results.cell(0, 1)).toHaveText('Alice');
    await results.toggleColumnVisibility('id');
    await expect(results.columnsButton).toContainText('(1/2)');
    await expect(results.cell(0, 0)).toHaveText('Alice');

    // Result 2 starts fresh.
    await results.selectResultTab(1);
    await expect(results.grid.locator('th.col-sorted')).toHaveCount(0);
    await expect(results.columnsButton).toContainText('(2/2)');
    await results.sortByColumn('num');
    await results.sortByColumn('num');
    await expect(results.cell(0, 0)).toHaveText('3');
    await results.toggleColumnVisibility('label');
    await expect(results.columnsButton).toContainText('(1/2)');

    // Both sets kept their own state across the switches.
    await results.selectResultTab(0);
    await expect(results.grid.locator('th.col-sorted[data-col="name"]')).toHaveCount(1);
    await expect(results.columnsButton).toContainText('(1/2)');
    await expect(results.cell(0, 0)).toHaveText('Alice');

    await results.selectResultTab(1);
    await expect(results.grid.locator('th.col-sorted[data-col="num"]')).toHaveCount(1);
    await expect(results.columnsButton).toContainText('(1/2)');
    await expect(results.cell(0, 0)).toHaveText('3');
  });

  test('a new run starts with fresh sort and column visibility', async ({ connections, editor, results, seed }) => {
    await connections.createAndConnect(SQLITE);
    const t = await seed.table('e2e_fresh', { insert: `(id, name) VALUES (1, 'Charlie'), (2, 'Alice')` });

    await editor.run(`SELECT id, name FROM ${t};`);
    await results.waitForRows();
    await results.sortByColumn('name');
    await expect(results.cell(0, 0)).toHaveText('2');
    await results.toggleColumnVisibility('id');
    await expect(results.columnsButton).toContainText('(1/2)');

    await editor.run(`SELECT id, name FROM ${t};`);
    await results.waitForRows();
    await expect(results.grid.locator('th.col-sorted')).toHaveCount(0);
    await expect(results.columnsButton).toContainText('(2/2)');
    await expect(results.cell(0, 0)).toHaveText('1');
  });

  test('keeps sort and hidden columns when visiting a table-view tab and back', async ({
    connections,
    editor,
    results,
    schema,
    seed,
    tableView,
    tabs,
  }) => {
    await connections.createAndConnect(SQLITE);
    const t = await seed.table('e2e_layers', { insert: `(id, name) VALUES (1, 'Charlie'), (2, 'Alice')` });

    await editor.run(`SELECT id, name FROM ${t};`);
    await results.waitForRows();
    await results.sortByColumn('name');
    await results.toggleColumnVisibility('id');
    await expect(results.cell(0, 0)).toHaveText('Alice');

    // Activating a table-view tab must not unmount the query workspace (and its grid state).
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();

    await tabs.tabs.filter({ hasText: 'Query 1' }).click();
    await results.waitForRows();
    await expect(results.grid.locator('th.col-sorted[data-col="name"]')).toHaveCount(1);
    await expect(results.columnsButton).toContainText('(1/2)');
    await expect(results.cell(0, 0)).toHaveText('Alice');
  });
});
