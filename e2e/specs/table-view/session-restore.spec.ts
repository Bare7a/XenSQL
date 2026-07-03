import { readFileSync } from 'node:fs';
import { SQLITE } from '@support/databases';
import { expect, test } from '@support/fixtures';

// The persisted editor session (owned by e2e-server.mjs's data dir).
const SESSION_FILE = new URL('../../XenSQL-data/editor_session.json', import.meta.url);

interface PersistedTableView {
  orderBy?: string;
  orderDir?: string;
  hiddenColumns?: string[];
}

function persistedTableView(): PersistedTableView | undefined {
  try {
    const session = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
    return session.tabs?.find((t: { tableView?: PersistedTableView }) => t.tableView)?.tableView;
  } catch {
    return undefined;
  }
}

test.describe('Table view - session restore', () => {
  test('restores sort and hidden columns after a reload', async ({ connections, seed, tableView, page }) => {
    await connections.createAndConnect(SQLITE);
    await seed.browseTable('e2e_tvrestore', { insert: `(id, name) VALUES (1, 'Charlie'), (2, 'Alice'), (3, 'Bob')` });

    await tableView.sortByColumn('name');
    await tableView.sortByColumn('name');
    await expect(tableView.cellAt(0, 0)).toHaveText('1');
    await tableView.toggleColumnVisibility('name');
    await expect(tableView.columnsButton).toContainText('(1/2)');

    // The change-driven save is debounced 1s.
    await expect
      .poll(persistedTableView, { timeout: 4_000 })
      .toMatchObject({ orderBy: 'name', orderDir: 'DESC', hiddenColumns: ['name'] });

    // Reload exercises the same restore path as an app restart.
    await page.reload();
    await tableView.waitForRows();
    await expect(tableView.cellAt(0, 0)).toHaveText('1');
    await expect(tableView.header('name')).toHaveCount(0);
    await expect(tableView.columnsButton).toContainText('(1/2)');
  });
});
