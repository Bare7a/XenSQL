import { POSTGRES, SQLITE } from '@support/databases';
import { expect, test } from '@support/fixtures';
import { uniqueIdent } from '@support/seed';

test.describe('Editor autocomplete', () => {
  test('shows autocomplete suggestions', async ({ connections, editor }) => {
    await connections.createAndConnect(POSTGRES);

    await editor.clear();
    await editor.type('SEL');
    await editor.triggerSuggestions();

    await expect(editor.suggestWidget).toBeVisible();
    await expect(editor.suggestWidget.locator('.monaco-list-row').first()).toBeVisible();
  });

  // SQLite so the test needs no database container.
  test('suggests a seeded table, its columns, and the FK join condition', async ({
    connections,
    editor,
    schema,
    seed,
    app,
  }) => {
    await connections.createAndConnect(SQLITE);

    const parent = await seed.table('ac_parent');
    const child = uniqueIdent('ac_child');
    await editor.run(`CREATE TABLE ${child} (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES ${parent}(id));`);
    await app.expectStatementApplied();
    await schema.refresh();

    await editor.clear();
    await editor.type(`SELECT * FROM ${parent.slice(0, 12)}`);
    await editor.triggerSuggestions();
    await expect(editor.suggestWidget.locator('.monaco-list-row', { hasText: parent })).toBeVisible();
    await editor.page.keyboard.press('Escape');

    await editor.clear();
    await editor.type(`SELECT * FROM ${parent} WHERE na`);
    await editor.triggerSuggestions();
    await expect(editor.suggestWidget.locator('.monaco-list-row', { hasText: 'name' }).first()).toBeVisible();
    await editor.page.keyboard.press('Escape');

    await editor.clear();
    await editor.type(`SELECT * FROM ${parent} JOIN ${child} ON `);
    await editor.triggerSuggestions();
    await expect(
      editor.suggestWidget.locator('.monaco-list-row', { hasText: `${child}.parent_id = ${parent}.id` }).first(),
    ).toBeVisible();
    await editor.page.keyboard.press('Escape');
  });
});
