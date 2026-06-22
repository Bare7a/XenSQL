import { expect, test } from '../fixtures';
import { POSTGRES } from '../support/databases';

test.describe('Saved queries', () => {
  test('opens a saved query into an editor tab', async ({ connections, editor, tabs, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.setSql('SELECT 1 AS opened;');
    await editor.saveQueryToLibrary('Openable query');
    // Close the tab first so re-opening from the library is observable.
    await tabs.closeActiveWithButton();

    await queries.open();
    await queries.showSaved();
    await queries.openSaved('Openable query');

    await expect(tabs.activeTab.locator('.tab-title')).toContainText('Openable query');
  });

  test('renames a saved query', async ({ connections, editor, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.setSql('SELECT 2 AS r;');
    await editor.saveQueryToLibrary('Before rename');

    await queries.open();
    await queries.showSaved();
    await queries.renameSaved('Before rename', 'After rename');

    await expect(queries.savedItem('After rename')).toBeVisible();
    await expect(queries.savedItem('Before rename')).toHaveCount(0);
  });

  test('deletes a saved query', async ({ connections, editor, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.setSql('SELECT 3 AS d;');
    await editor.saveQueryToLibrary('Deletable query');

    await queries.open();
    await queries.showSaved();
    await expect(queries.savedItem('Deletable query')).toBeVisible();

    await queries.deleteSaved('Deletable query');
    await expect(queries.savedItem('Deletable query')).toHaveCount(0);
  });

  test('pins a saved query', async ({ connections, editor, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.setSql('SELECT 4 AS p;');
    await editor.saveQueryToLibrary('Pinnable query');

    await queries.open();
    await queries.showSaved();
    await queries.pinSaved('Pinnable query');

    await expect(queries.savedRow('Pinnable query').locator('.sidebar-pin-icon')).toBeVisible();
  });
});
