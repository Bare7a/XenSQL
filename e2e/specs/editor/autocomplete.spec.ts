import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Editor autocomplete', () => {
  test('shows autocomplete suggestions', async ({ connections, editor }) => {
    await connections.createAndConnect(POSTGRES);

    await editor.clear();
    await editor.type('SEL');
    await editor.triggerSuggestions();

    await expect(editor.suggestWidget).toBeVisible();
    await expect(editor.suggestWidget.locator('.monaco-list-row').first()).toBeVisible();
  });
});
