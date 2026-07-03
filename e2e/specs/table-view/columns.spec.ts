import { SQLITE } from '@support/databases';
import { expect, test } from '@support/fixtures';

// Driver-agnostic column-picker behavior, so sqlite keeps these runnable without the container stack.
test.describe('Table view - column visibility', () => {
  test('hides columns via the picker and scopes the export dialog to visible ones', async ({
    connections,
    seed,
    tableView,
    page,
  }) => {
    await connections.createAndConnect(SQLITE);
    await seed.browseTable('e2e_tvcols', { insert: `(id, name) VALUES (1, 'Alice'), (2, 'Bob')` });

    await expect(tableView.columnsButton).toContainText('(2/2)');
    await tableView.toggleColumnVisibility('name');
    await expect(tableView.header('name')).toHaveCount(0);
    await expect(tableView.columnsButton).toContainText('(1/2)');

    // The export dialog defaults to the visible-column scope.
    await tableView.pane.getByRole('button', { name: 'Export as' }).click();
    const colsGroup = page.locator('#export-cols-group');
    await expect(colsGroup.getByRole('button', { name: 'All (2)' })).toBeVisible();
    await expect(colsGroup.getByRole('button', { name: 'Visible (1)' })).toHaveClass(/active/);
    await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();

    await tableView.toggleColumnVisibility('name');
    await expect(tableView.header('name')).toHaveCount(1);
    await expect(tableView.columnsButton).toContainText('(2/2)');
  });

  test('reopening a closed tab restores sort and hidden columns', async ({ connections, seed, tableView, tabs }) => {
    await connections.createAndConnect(SQLITE);
    await seed.browseTable('e2e_tvreopen', { insert: `(id, name) VALUES (1, 'Charlie'), (2, 'Alice'), (3, 'Bob')` });

    await tableView.sortByColumn('name');
    await expect(tableView.cellAt(0, 0)).toHaveText('2');
    await tableView.toggleColumnVisibility('name');
    await expect(tableView.columnsButton).toContainText('(1/2)');

    await tabs.closeActiveWithKeyboard();
    await tabs.reopenClosedTab();
    await tableView.waitForRows();

    await expect(tableView.cellAt(0, 0)).toHaveText('2');
    await expect(tableView.header('name')).toHaveCount(0);
    await expect(tableView.columnsButton).toContainText('(1/2)');
  });
});
