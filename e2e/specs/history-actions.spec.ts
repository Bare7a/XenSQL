import { expect, test } from '../fixtures';
import { POSTGRES } from '../support/databases';

test.describe('Query history', () => {
  test('opens a history entry into the editor', async ({ connections, editor, results, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.run('SELECT 555 AS hist_open;');
    await results.waitForRows();
    // Empty the editor so opening from history is what restores the SQL.
    await editor.clear();

    await queries.open();
    await queries.showHistory();
    await queries.openHistory('SELECT 555');

    // Opening loads the SQL but doesn't auto-run; run it to confirm.
    await editor.runAll();
    await results.waitForRows();
    await expect(results.cell(0, 0)).toHaveText('555');
  });

  test('deletes a history entry', async ({ connections, editor, results, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.run('SELECT 777 AS hist_del;');
    await results.waitForRows();

    await queries.open();
    await queries.showHistory();
    await expect(queries.historyItem('SELECT 777')).toBeVisible();

    await queries.deleteHistory('SELECT 777');
    await expect(queries.historyItem('SELECT 777')).toHaveCount(0);
  });

  test('clears all history', async ({ app, connections, editor, results, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.run('SELECT 888 AS hist_clear;');
    await results.waitForRows();

    await queries.open();
    await queries.showHistory();
    await expect(queries.historyItem('SELECT 888')).toBeVisible();

    await queries.clearAllHistory();
    await expect(app.sidebar).toContainText('No query history');
  });
});
