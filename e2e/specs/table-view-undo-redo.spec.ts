import { expect, test } from '../fixtures';
import { POSTGRES, uniqueIdent } from '../support/databases';

test.describe('Table view - undo/redo', () => {
  test('undoes and redoes a pending cell edit', async ({ app, connections, editor, schema, tableView }) => {
    const t = uniqueIdent('e2e_undo');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice');`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();

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
