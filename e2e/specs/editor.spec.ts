import { expect, test } from '../fixtures';
import { POSTGRES } from '../support/databases';

test.describe('SQL editor', () => {
  test('shows autocomplete suggestions', async ({ connections, editor }) => {
    await connections.createAndConnect(POSTGRES);

    await editor.clear();
    await editor.type('SEL');
    await editor.triggerSuggestions();

    await expect(editor.suggestWidget).toBeVisible();
    await expect(editor.suggestWidget.locator('.monaco-list-row').first()).toBeVisible();
  });

  test('saves a query to the library', async ({ connections, editor, queries }) => {
    await connections.createAndConnect(POSTGRES);

    await editor.setSql('SELECT 42 AS answer;');
    await editor.saveQueryToLibrary('E2E Saved Query');

    await queries.open();
    await queries.showSaved();
    await expect(queries.savedItem('E2E Saved Query')).toBeVisible();
  });

  test('records executed queries in history', async ({ connections, editor, results, queries }) => {
    await connections.createAndConnect(POSTGRES);

    await editor.run('SELECT 314 AS hist;');
    await results.waitForRows();

    await queries.open();
    await queries.showHistory();
    await expect(queries.historyItem('SELECT 314')).toBeVisible();
  });
});
