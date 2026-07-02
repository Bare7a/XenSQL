import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Editor tabs', () => {
  test('opens, switches and closes tabs via keyboard', async ({ connections, tabs }) => {
    // Connecting opens the first query tab; "+" opens a second on the same connection.
    await connections.createAndConnect(POSTGRES);
    await expect(tabs.tabs).toHaveCount(1);

    await tabs.newTab();
    await expect(tabs.tabs).toHaveCount(2);
    await expect(tabs.tabs.nth(1)).toHaveClass(/active/);

    // Ctrl+Shift+Tab → previous, Ctrl+Tab → next.
    await tabs.prevTab();
    await expect(tabs.tabs.nth(0)).toHaveClass(/active/);
    await tabs.nextTab();
    await expect(tabs.tabs.nth(1)).toHaveClass(/active/);

    // Ctrl+W closes the active scratch tab with no prompt.
    await tabs.closeActiveWithKeyboard();
    await expect(tabs.tabs).toHaveCount(1);
  });

  test('closes a tab with its close button', async ({ connections, tabs }) => {
    await connections.createAndConnect(POSTGRES);
    await tabs.newTab();
    await expect(tabs.tabs).toHaveCount(2);

    await tabs.closeActiveWithButton();
    await expect(tabs.tabs).toHaveCount(1);
  });
});
