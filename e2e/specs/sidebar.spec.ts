import { expect, test } from '../fixtures';
import { POSTGRES, uniqueIdent } from '../support/databases';

test.describe('Sidebar', () => {
  test('filters the schema browser by name', async ({ app, connections, editor, schema }) => {
    const keep = uniqueIdent('e2e_keep');
    const other = uniqueIdent('e2e_other');
    await connections.createAndConnect(POSTGRES);
    await editor.run(`CREATE TABLE ${keep} (id INTEGER PRIMARY KEY);`);
    await app.expectStatementApplied();
    await editor.run(`CREATE TABLE ${other} (id INTEGER PRIMARY KEY);`);
    await app.expectStatementApplied();

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

    await queries.open();
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

    await queries.open();
    await queries.showHistory();

    await queries.filterHistory('111');
    await expect(queries.historyItem('SELECT 111')).toBeVisible();
    await expect(queries.historyItem('SELECT 222')).toHaveCount(0);
  });
});
