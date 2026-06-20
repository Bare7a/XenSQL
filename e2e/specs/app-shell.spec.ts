import { expect, test } from '../fixtures';

test.describe('App shell', () => {
  test('loads the application shell', async ({ app, page }) => {
    await expect(page).toHaveTitle('XenSQL');
    await expect(app.sidebar).toBeVisible();
    await expect(page.getByRole('button', { name: 'Schema' })).toBeVisible();
  });

  test('opens and closes the connection sidebar', async ({ app }) => {
    await expect(app.sidebar).toBeVisible();
    await app.toggleSidebar();
    await expect(app.sidebar).toBeHidden();
    await app.toggleSidebar();
    await expect(app.sidebar).toBeVisible();
  });

  test('opens and closes the JSON viewer', async ({ app }) => {
    await expect(app.jsonViewer).toBeHidden();
    await app.toggleJsonViewer();
    await expect(app.jsonViewer).toBeVisible();
    await app.toggleJsonViewer();
    await expect(app.jsonViewer).toBeHidden();
  });
});
