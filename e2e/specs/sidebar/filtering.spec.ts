import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Sidebar filtering', () => {
  test('filters the schema browser by name', async ({ app, connections, schema, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const keep = await seed.table('e2e_keep', { columns: '(id INTEGER PRIMARY KEY)' });
    const other = await seed.table('e2e_other', { columns: '(id INTEGER PRIMARY KEY)' });

    await schema.refresh();
    await schema.revealTable(keep); // expand schema so its tables load

    await schema.search(keep);
    await expect(schema.tableRow(keep)).toBeVisible();
    await expect(schema.tableRow(other)).toBeHidden();

    await schema.search('zzz_definitely_no_such_table');
    await expect(app.sidebar).toContainText('No matches');

    await schema.clearSearch();
    await expect(schema.tableRow(keep)).toBeVisible();
  });

  test('filters saved queries and sorts them by name', async ({ connections, editor, tabs, queries }) => {
    await connections.createAndConnect(POSTGRES);

    // Fresh tab for the second so Save creates a new query, not updates the first.
    await editor.setSql('SELECT 1 AS zebra;');
    await editor.saveQueryToLibrary('Zebra query');
    await tabs.newTab();
    await editor.setSql('SELECT 2 AS apple;');
    await editor.saveQueryToLibrary('Apple query');

    await queries.showSaved();

    await queries.filterSaved('Apple');
    await expect(queries.savedItem('Apple query')).toBeVisible();
    await expect(queries.savedItem('Zebra query')).toBeHidden();
    await queries.filterSaved('');

    await queries.sortBy('Name');
    const titles = await queries.savedTitlesInOrder();
    expect(titles).toContain('Apple query');
    expect(titles).toContain('Zebra query');
    expect(titles.indexOf('Apple query')).toBeLessThan(titles.indexOf('Zebra query'));
  });

  test('filters query history', async ({ connections, editor, results, queries }) => {
    await connections.createAndConnect(POSTGRES);
    await editor.run('SELECT 111 AS alpha;');
    await results.waitForRows();
    await editor.run('SELECT 222 AS beta;');
    await results.waitForRows();

    await queries.showHistory();

    await queries.filterHistory('111');
    await expect(queries.historyItem('SELECT 111')).toBeVisible();
    await expect(queries.historyItem('SELECT 222')).toHaveCount(0);
  });
});
