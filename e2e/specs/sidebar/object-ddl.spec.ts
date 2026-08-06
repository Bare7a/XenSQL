import { POSTGRES } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('Object DDL and the deeper schema tree', () => {
  test("lists a table's indexes, constraints and triggers", async ({ connections, editor, schema, seed, app }) => {
    await connections.createAndConnect(POSTGRES);
    const parent = await seed.table('e2e_ddl_parent');
    const child = await seed.table('e2e_ddl_child', {
      columns: `(id INTEGER PRIMARY KEY, email VARCHAR(50) NOT NULL UNIQUE, parent_id INTEGER REFERENCES ${parent}(id))`,
    });
    await editor.run(`CREATE INDEX ${child}_email_idx ON ${child} (email);`);
    await app.expectStatementApplied();
    await schema.refresh();

    await schema.expandGroup(child, 'indexes');
    await expect(schema.objectRow('indexes', `${child}_email_idx`)).toBeVisible();
    await expect(schema.objectRow('indexes', `${child}_pkey`)).toContainText('PK');

    await schema.expandGroup(child, 'constraints');
    // Postgres names its constraints, so the row shows the name plus a PK badge and its columns.
    const pk = schema.objectRow('constraints', `${child}_pkey`);
    await expect(pk).toContainText('PK');
    await expect(pk).toContainText('(id)');
    const fk = schema.groupRows('constraints').filter({ hasText: 'FK' }).first();
    await expect(fk).toContainText(parent);

    await schema.expandGroup(child, 'triggers');
    await expect(schema.groupRow('triggers').first()).toBeVisible();
    await expect(schema.groupRows('triggers')).toHaveCount(0);
  });

  test('marks a view apart from a table', async ({ connections, editor, schema, seed, app }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('e2e_ddl_v', { insert: `(id, name) VALUES (1, 'Alice')` });
    const view = `${table}_view`;
    await editor.run(`CREATE VIEW ${view} AS SELECT id, name FROM ${table};`);
    await app.expectStatementApplied();
    await schema.refresh();

    const viewRow = await schema.revealTable(view);
    await expect(viewRow).toHaveAttribute('data-object-kind', 'view');
    await expect(viewRow).toContainText('VIEW');
    await expect(schema.tableRow(table)).toHaveAttribute('data-object-kind', 'table');
  });

  test("copies a table's DDL to the clipboard", async ({ connections, schema, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('e2e_ddl_copy', {
      columns: '(id INTEGER PRIMARY KEY, email VARCHAR(50) NOT NULL)',
    });
    await schema.refresh();

    await schema.copyTableDDL(table);
    await expect(async () => {
      const ddl = await schema.clipboardText();
      expect(ddl).toContain(`CREATE TABLE`);
      expect(ddl).toContain(table);
      expect(ddl).toContain('email');
      expect(ddl).toContain('NOT NULL');
      expect(ddl).toContain('PRIMARY KEY');
    }).toPass({ timeout: 15_000 });
  });

  test("opens a table's DDL in a new editor tab", async ({ connections, editor, schema, seed, tabs }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('e2e_ddl_tab');
    await schema.refresh();

    await schema.openTableDDLInTab(table);
    await expect(tabs.activeTitle).toContainText(`DDL: ${table}`);
    await expect(editor.active.locator('.view-lines')).toContainText('CREATE TABLE');
    await expect(editor.active.locator('.view-lines')).toContainText(table);
  });

  test("copies an index's own DDL", async ({ connections, editor, schema, seed, app }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('e2e_ddl_idx');
    const index = `${table}_name_idx`;
    await editor.run(`CREATE INDEX ${index} ON ${table} (name);`);
    await app.expectStatementApplied();
    await schema.refresh();

    await schema.expandGroup(table, 'indexes');
    await schema.copyObjectDDL('indexes', index);
    await expect(async () => {
      const ddl = await schema.clipboardText();
      expect(ddl).toContain('CREATE INDEX');
      expect(ddl).toContain(index);
    }).toPass({ timeout: 15_000 });
  });

  test("lists schema functions", async ({ connections, editor, schema, app }) => {
    await connections.createAndConnect(POSTGRES);
    const fn = `e2e_ddl_fn_${Date.now().toString(36)}`;
    await editor.run(`CREATE FUNCTION ${fn}(a int) RETURNS int LANGUAGE sql AS $$ SELECT a + 1 $$;`);
    await app.expectStatementApplied();
    await schema.refresh();

    await schema.expandRoutines();
    await expect(schema.page.getByTestId('schema-group-routines-row').filter({ hasText: fn })).toBeVisible({
      timeout: 30_000,
    });

    await editor.run(`DROP FUNCTION ${fn}(int);`);
    await app.expectStatementApplied();
  });
});
