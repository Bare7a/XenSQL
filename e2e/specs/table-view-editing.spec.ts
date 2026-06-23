import { expect, test } from '../fixtures';
import { POSTGRES, uniqueIdent } from '../support/databases';

// In every test `id` is column position 0, `name` is 1.
test.describe('Table view - editing', () => {
  test('edits a cell and persists it with Apply', async ({ app, connections, editor, schema, tableView }) => {
    const t = uniqueIdent('e2e_edit');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice');`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();

    await tableView.editCell(0, 1, 'Updated');
    await expect(tableView.cellAt(0, 1)).toHaveClass(/cell-pending-edit/);
    await expect(tableView.pendingUpdates).toContainText('1');

    await tableView.apply();
    // Re-read from the database to prove it persisted.
    await tableView.refresh();
    await expect(tableView.cellAt(0, 1)).toHaveText('Updated');
  });

  test('returns focus to the committed cell after editing', async ({ app, connections, editor, schema, tableView }) => {
    const t = uniqueIdent('e2e_edit_focus');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice');`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();

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

  test('sets a cell to NULL and persists it', async ({ app, connections, editor, schema, tableView }) => {
    const t = uniqueIdent('e2e_null');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice');`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();

    await tableView.setCellNull(0, 1);
    await expect(tableView.cellAt(0, 1)).toHaveClass(/null-val/);
    await expect(tableView.cellAt(0, 1)).toHaveText('NULL');

    await tableView.apply();
    await tableView.refresh();
    await expect(tableView.cellAt(0, 1)).toHaveText('NULL');
  });

  test('marks a row for delete and applies it', async ({ app, connections, editor, schema, tableView }) => {
    const t = uniqueIdent('e2e_del');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice'), (2, 'Bob');`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();

    await tableView.markRowForDelete(0);
    await expect(tableView.grid.locator('tr.row-pending-delete')).toHaveCount(1);
    await expect(tableView.pendingDeletes).toContainText('1');

    await tableView.apply();
    await tableView.refresh();
    await expect(tableView.rowCountLabel).toContainText('1 row');
  });

  test('reset discards pending edits', async ({ app, connections, editor, schema, tableView }) => {
    const t = uniqueIdent('e2e_reset');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice');`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();

    await tableView.editCell(0, 1, 'Temp');
    await expect(tableView.cellAt(0, 1)).toHaveClass(/cell-pending-edit/);

    await tableView.reset();
    await expect(tableView.cellAt(0, 1)).toHaveText('Alice');
    await expect(tableView.cellAt(0, 1)).not.toHaveClass(/cell-pending-edit/);
  });
});
