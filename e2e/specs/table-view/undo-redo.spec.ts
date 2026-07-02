import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Table view - undo/redo', () => {
  test('undoes and redoes a pending cell edit', async ({ connections, seed, tableView }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_undo', { insert: `(id, name) VALUES (1, 'Alice')` });

    await tableView.editCell(0, 1, 'Changed');
    await expect(tableView.cellAt(0, 1)).toHaveText('Changed');
    await expect(tableView.cellAt(0, 1)).toHaveClass(/cell-pending-edit/);

    // Undo/redo are grid-scoped: a cell, not the inline input, must hold focus.
    await tableView.focusCell(0, 0);
    await tableView.undo();
    await expect(tableView.cellAt(0, 1)).toHaveText('Alice');
    await expect(tableView.cellAt(0, 1)).not.toHaveClass(/cell-pending-edit/);

    await tableView.redo();
    await expect(tableView.cellAt(0, 1)).toHaveText('Changed');
    await expect(tableView.cellAt(0, 1)).toHaveClass(/cell-pending-edit/);
  });
});
