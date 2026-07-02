import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

// `data` (JSON column) is column position 1.
test.describe('Table view - cell viewer', () => {
  test('opens a JSON cell with Shift+Enter and beautifies/minifies it', async ({
    cellViewer,
    connections,
    seed,
    tableView,
  }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_json', {
      columns: '(id INTEGER PRIMARY KEY, data JSON)',
      insert: `(id, data) VALUES (1, '{"a":1,"b":2,"c":3}')`,
    });

    await tableView.openCellViewer(0, 1);
    await cellViewer.waitForOpen();
    await cellViewer.setKind('json');

    await cellViewer.beautify();
    await expect(cellViewer.lines).toContainText('lines'); // pretty-printed → many lines
    await cellViewer.minify();
    await expect(cellViewer.lines).toHaveText('1 line'); // minified → one line
    await cellViewer.close();
  });

  test('sets a JSON cell to NULL from the cell viewer', async ({ cellViewer, connections, seed, tableView }) => {
    await connections.createAndConnect(POSTGRES);
    await seed.browseTable('e2e_jsonnull', {
      columns: '(id INTEGER PRIMARY KEY, data JSON)',
      insert: `(id, data) VALUES (1, '{"a":1}')`,
    });

    await tableView.openCellViewer(0, 1);
    await cellViewer.waitForOpen();
    await cellViewer.setNull();
    await expect(cellViewer.modal).toBeHidden();

    await expect(tableView.cellAt(0, 1)).toHaveText('NULL');
    await expect(tableView.cellAt(0, 1)).toHaveClass(/cell-pending-edit/);
  });
});
