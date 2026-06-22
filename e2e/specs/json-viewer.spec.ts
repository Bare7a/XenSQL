import { expect, test } from '../fixtures';
import { POSTGRES } from '../support/databases';

test.describe('JSON viewer', () => {
  test('mirrors the focused row and filters by key', async ({ connections, editor, results, jsonViewer }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.run(`SELECT 1 AS id, 'Zelda' AS name;`);
    await results.waitForRows();

    await jsonViewer.open();
    await results.focusRow(0);
    await expect(jsonViewer.content).toContainText('Zelda');
    await expect(jsonViewer.content).toContainText('name');

    // Filtering to "name" hides the id key.
    await jsonViewer.filterKeys('name');
    await expect(jsonViewer.content).toContainText('name');
    await expect(jsonViewer.content).not.toContainText('id');

    // Ctrl+J toggles it closed.
    await jsonViewer.toggle();
    await expect(jsonViewer.panel).toBeHidden();
  });

  test('nests JSON cell values as objects', async ({ connections, editor, results, jsonViewer }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.run(`SELECT 7 AS id, '{"x":42}'::json AS data;`);
    await results.waitForRows();

    await jsonViewer.open();
    await results.focusRow(0);
    await expect(jsonViewer.content).toContainText('"x": 42');
  });
});
