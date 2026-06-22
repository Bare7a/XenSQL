import { expect, test } from '../fixtures';
import { POSTGRES, uniqueIdent } from '../support/databases';

test.describe('Table view - selection', () => {
  test('selects a cell, a range, a column and a row', async ({ app, connections, editor, schema, tableView }) => {
    const t = uniqueIdent('e2e_sel');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, name VARCHAR(50));`);
    await app.expectStatementApplied();
    await editor.run(`INSERT INTO ${t} (id, name) VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Cara');`);
    await app.expectStatementApplied();
    await schema.refresh();
    await schema.browseTable(t);
    await tableView.waitForRows();

    // Single cell focus.
    await tableView.focusCell(0, 0);
    await expect(tableView.focusedCell()).toHaveCount(1);

    // Shift-click extends a 3-cell range down column 0; focus styling yields to selection.
    await tableView.cellAt(2, 0).click({ modifiers: ['Shift'] });
    await expect(tableView.selectedCells()).toHaveCount(3);
    await expect(tableView.selectionCount()).toContainText('selected');

    // Plain header click selects the whole column.
    await tableView.selectColumn('name');
    await expect(tableView.selectedHeader()).toHaveCount(1);

    // Gutter click selects the whole row (both columns).
    await tableView.rownum(1).click();
    await expect(tableView.selectedCells()).toHaveCount(2);
  });
});
