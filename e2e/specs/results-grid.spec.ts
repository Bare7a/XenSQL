import { expect, test } from '../fixtures';
import { POSTGRES, uniqueIdent } from '../support/databases';

test.describe('Results grid', () => {
  test('sorts a column ascending then descending', async ({ app, connections, editor, results }) => {
    const t = uniqueIdent('e2e_sort');
    await connections.create(POSTGRES);
    await connections.connect(POSTGRES.label);

    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Charlie'), (2, 'Alice'), (3, 'Bob');`);
    await app.expectStatementApplied();

    await editor.run(`SELECT id, name FROM ${t};`);
    await results.waitForRows();

    await results.sortByColumn('name');
    await expect(results.cell(0, 1)).toHaveText('Alice');

    await results.sortByColumn('name');
    await expect(results.cell(0, 1)).toHaveText('Charlie');
  });

  test('shows the focused row in the JSON viewer', async ({ app, connections, editor, results }) => {
    await connections.create(POSTGRES);
    await connections.connect(POSTGRES.label);

    await editor.run(`SELECT 1 AS id, 'Zelda' AS name;`);
    await results.waitForRows();

    await app.toggleJsonViewer();
    await expect(app.jsonViewer).toBeVisible();

    await results.focusRow(0);
    await expect(app.jsonViewer).toContainText('Zelda');

    await app.toggleJsonViewer();
    await expect(app.jsonViewer).toBeHidden();
  });
});
