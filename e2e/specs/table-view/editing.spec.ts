import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

// The default seeded table: `id` is column position 0, `name` is 1.
test.describe('Table view - editing', () => {
  test('edits a cell and persists it with Apply', async ({ connections, seed, tableView }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_edit', { insert: `(id, name) VALUES (1, 'Alice')` });

    await tableView.editCell(0, 1, 'Updated');
    await expect(tableView.cellAt(0, 1)).toHaveClass(/cell-pending-edit/);
    await expect(tableView.pendingUpdates).toContainText('1');

    await tableView.apply();
    // Re-read from the database to prove it persisted.
    await tableView.refresh();
    await expect(tableView.cellAt(0, 1)).toHaveText('Updated');
  });

  test('returns focus to the committed cell after editing', async ({ connections, seed, tableView }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_edit_focus', { insert: `(id, name) VALUES (1, 'Alice')` });

    await tableView.editCell(0, 1, 'Updated');
    await expect(tableView.cellAt(0, 1)).toHaveClass(/cell-pending-edit/);

    // Assert DOM focus, not the cell-focused class: an edited cell has cell-pending-edit, which
    // suppresses cell-focused.
    await expect(tableView.cellAt(0, 1)).toBeFocused();

    // Ctrl+Z is grid-scoped, so it only undoes if focus really returned to the grid (no focusCell here).
    await tableView.undo();
    await expect(tableView.cellAt(0, 1)).toHaveText('Alice');
    await expect(tableView.cellAt(0, 1)).not.toHaveClass(/cell-pending-edit/);
  });

  test('sets a cell to NULL and persists it', async ({ connections, seed, tableView }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_null', { insert: `(id, name) VALUES (1, 'Alice')` });

    await tableView.setCellNull(0, 1);
    await expect(tableView.cellAt(0, 1)).toHaveClass(/null-val/);
    await expect(tableView.cellAt(0, 1)).toHaveText('NULL');

    await tableView.apply();
    await tableView.refresh();
    await expect(tableView.cellAt(0, 1)).toHaveText('NULL');
  });

  test('marks a row for delete and applies it', async ({ connections, seed, tableView }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_del', { insert: `(id, name) VALUES (1, 'Alice'), (2, 'Bob')` });

    await tableView.markRowForDelete(0);
    await expect(tableView.grid.locator('tr.row-pending-delete')).toHaveCount(1);
    await expect(tableView.pendingDeletes).toContainText('1');

    await tableView.apply();
    await tableView.refresh();
    await expect(tableView.rowCountLabel).toContainText('1 row');
  });

  test('reset discards pending edits', async ({ connections, seed, tableView }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_reset', { insert: `(id, name) VALUES (1, 'Alice')` });

    await tableView.editCell(0, 1, 'Temp');
    await expect(tableView.cellAt(0, 1)).toHaveClass(/cell-pending-edit/);

    await tableView.reset();
    await expect(tableView.cellAt(0, 1)).toHaveText('Alice');
    await expect(tableView.cellAt(0, 1)).not.toHaveClass(/cell-pending-edit/);
  });
});
