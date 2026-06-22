import { expect, test } from '../fixtures';
import { POSTGRES, uniqueIdent } from '../support/databases';

test.describe('Schema actions', () => {
  test('opens "SELECT in new tab" and runs it', async ({ app, connections, editor, schema, results, tabs }) => {
    const t = uniqueIdent('e2e_sel');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice');`);
    await app.expectStatementApplied();
    await schema.refresh();

    await schema.selectInNewTab(t);
    await expect(tabs.activeTab.locator('.tab-title')).toContainText(t);

    await editor.runAll();
    await results.waitForRows();
    await expect(results.cell(0, 0)).toHaveText('1');
  });

  test('counts rows from the context menu', async ({ app, connections, editor, schema, results, tabs }) => {
    const t = uniqueIdent('e2e_cnt');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice'), (2, 'Bob');`);
    await app.expectStatementApplied();
    await schema.refresh();

    await schema.countRows(t);
    await expect(tabs.activeTab.locator('.tab-title')).toContainText(`Count: ${t}`);

    await editor.runAll();
    await results.waitForRows();
    await expect(results.cell(0, 0)).toHaveText('2');
  });

  test('inserts a column name into the editor', async ({ app, connections, editor, schema }) => {
    const t = uniqueIdent('e2e_col');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, distinctive_col VARCHAR(50));`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.expandColumns(t);
    await editor.clear();

    await schema.insertColumn('distinctive_col');
    await expect(editor.active.locator('.view-lines')).toContainText('distinctive_col');
  });
});
