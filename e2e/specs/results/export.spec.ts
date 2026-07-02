import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

// Covers the "Export as" dialog UI only. "Save to file" (native OS dialog) and
// "Copy to clipboard" (Wails clipboard) aren't driven here.
test.describe('Export', () => {
  test('switches format and scope and reflects them in the summary', async ({ connections, editor, results }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.run(`SELECT * FROM (VALUES (1, 'a'), (2, 'b')) AS t(id, label);`);
    await results.waitForRows();

    await results.openExportDialog();
    await expect(results.exportSummary).toContainText('2 row');

    // "Selected" stays disabled until rows are selected in the grid.
    const selectedRows = results.exportRowsGroup.getByRole('button', { name: /Selected/ });
    await expect(selectedRows).toBeDisabled();

    await results.setExportFormat('json');
    await expect(results.exportSummary).toContainText('JSON');

    await results.cancelExport();
  });

  test('enables selected-rows export after a row selection', async ({ connections, editor, results }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.run(`SELECT * FROM (VALUES (1, 'a'), (2, 'b'), (3, 'c')) AS t(id, label);`);
    await results.waitForRows();

    // Click first, shift-click last → selects all three rows.
    await results.rownum(0).click();
    await results.rownum(2).click({ modifiers: ['Shift'] });

    await results.openExportDialog();
    const selectedRows = results.exportRowsGroup.getByRole('button', { name: /Selected/ });
    await expect(selectedRows).toBeEnabled();
    await selectedRows.click();
    await expect(results.exportSummary).toContainText('3 row');

    await results.cancelExport();
  });
});
