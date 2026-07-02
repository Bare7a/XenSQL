import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Results grid', () => {
  test('sorts a column ascending then descending', async ({ connections, editor, results, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const t = await seed.table('e2e_sort', { insert: `(id, name) VALUES (1, 'Charlie'), (2, 'Alice'), (3, 'Bob')` });

    await editor.run(`SELECT id, name FROM ${t};`);
    await results.waitForRows();

    await results.sortByColumn('name');
    await expect(results.cell(0, 1)).toHaveText('Alice');

    await results.sortByColumn('name');
    await expect(results.cell(0, 1)).toHaveText('Charlie');
  });

  test('shows the focused row in the JSON viewer', async ({ connections, editor, results, jsonViewer }) => {
    await connections.createAndConnect(POSTGRES);

    await editor.run(`SELECT 1 AS id, 'Zelda' AS name;`);
    await results.waitForRows();

    // Toggle via Ctrl+J; the View-menu path is racy (covered in app-shell.spec).
    await jsonViewer.open();
    await results.focusRow(0);
    await expect(jsonViewer.panel).toContainText('Zelda');

    await jsonViewer.toggle();
    await expect(jsonViewer.panel).toBeHidden();
  });
});
