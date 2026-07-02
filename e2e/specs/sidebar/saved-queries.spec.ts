import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Saved queries', () => {
  test('saves a query to the library', async ({ connections, editor, queries }) => {
    await connections.createAndConnect(POSTGRES);

    await editor.setSql('SELECT 42 AS answer;');
    await editor.saveQueryToLibrary('E2E Saved Query');

    await queries.showSaved();
    await expect(queries.savedItem('E2E Saved Query')).toBeVisible();
  });

  test('opens a saved query into an editor tab', async ({ connections, editor, tabs, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.setSql('SELECT 1 AS opened;');
    await editor.saveQueryToLibrary('Openable query');
    // Close the tab first so re-opening from the library is observable.
    await tabs.closeActiveWithButton();

    await queries.showSaved();
    await queries.openSaved('Openable query');

    await expect(tabs.activeTitle).toContainText('Openable query');
  });

  test('renames a saved query', async ({ connections, editor, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.setSql('SELECT 2 AS r;');
    await editor.saveQueryToLibrary('Before rename');

    await queries.showSaved();
    await queries.renameSaved('Before rename', 'After rename');

    await expect(queries.savedItem('After rename')).toBeVisible();
    await expect(queries.savedItem('Before rename')).toHaveCount(0);
  });

  test('deletes a saved query', async ({ connections, editor, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.setSql('SELECT 3 AS d;');
    await editor.saveQueryToLibrary('Deletable query');

    await queries.showSaved();
    await expect(queries.savedItem('Deletable query')).toBeVisible();

    await queries.deleteSaved('Deletable query');
    await expect(queries.savedItem('Deletable query')).toHaveCount(0);
  });

  test('pins a saved query', async ({ connections, editor, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.setSql('SELECT 4 AS p;');
    await editor.saveQueryToLibrary('Pinnable query');

    await queries.showSaved();
    await queries.pinSaved('Pinnable query');

    await expect(queries.savedRow('Pinnable query').locator('.sidebar-pin-icon')).toBeVisible();
  });
});
