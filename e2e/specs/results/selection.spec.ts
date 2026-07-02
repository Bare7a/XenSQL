import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Results grid - selection', () => {
  test('selects a cell, a range, a column and a row', async ({ connections, editor, results }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.run(`SELECT * FROM (VALUES (1, 'a'), (2, 'b'), (3, 'c')) AS t(id, label);`);
    await results.waitForRows();

    // Single cell focus.
    await results.cell(0, 0).click();
    await expect(results.focusedCell()).toHaveCount(1);

    // Shift-click extends a 3-cell range; count indicator appears for multi-select.
    await results.cell(2, 0).click({ modifiers: ['Shift'] });
    await expect(results.selectedCells()).toHaveCount(3);
    await expect(results.selectionCount()).toContainText('selected');

    // Plain header click selects the whole column.
    await results.selectColumn('label');
    await expect(results.selectedHeader()).toHaveCount(1);

    // Gutter click selects the whole row (both columns).
    await results.rownum(1).click();
    await expect(results.selectedCells()).toHaveCount(2);
  });
});
