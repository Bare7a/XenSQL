import { ALL_DATABASES, POSTGRES, SQLITE } from '@support/databases';
import { expect, test } from '@support/fixtures';

test.describe('Query plan', () => {
  for (const db of ALL_DATABASES) {
    test(`explains a query: ${db.label}`, async ({ connections, editor, plan, seed }) => {
      await connections.createAndConnect(db);
      const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice'), (2, 'Bob')" });

      await editor.setSql(`SELECT * FROM ${table} WHERE id = 1;`);
      await plan.explain();

      expect(await plan.nodeLabels()).not.toHaveLength(0);
      await expect(plan.badge).toHaveText('Estimated');
      // Only SQLite has a note: its missing metric columns.
      await expect(plan.notes).toHaveCount(db.key === 'sqlite' ? 1 : 0);
    });
  }

  // Only analyze executes the statement.
  test('the shortcuts pick estimates vs measured', async ({ connections, editor, plan, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice')" });

    await editor.setSql(`SELECT * FROM ${table};`);
    await plan.explainByShortcut();
    await expect(plan.badge).toHaveText('Estimated');

    await plan.explainAnalyzeByShortcut();
    await expect(plan.badge).toHaveText('Measured');
  });

  test('measures rows and timings with analyze', async ({ connections, editor, plan, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice'), (2, 'Bob')" });

    await editor.setSql(`SELECT * FROM ${table};`);
    await plan.explainAnalyze();

    await expect(plan.badge).toHaveText('Measured');
    expect(await plan.metricColumns()).toContain('Time');
    expect(await plan.hottestLabel()).toBeTruthy();
    const heats = await plan.heats();
    expect(Math.max(...heats)).toBe(1);
  });

  test('heat map re-ranks when the metric changes', async ({ connections, editor, plan, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice'), (2, 'Bob')" });

    await editor.setSql(`SELECT * FROM ${table} ORDER BY name;`);
    await plan.explain();

    expect(await plan.metricColumns()).toEqual(['Rows', 'Cost']);
    await plan.heatBy('Rows');
    expect(Math.max(...(await plan.heats()))).toBe(1);
  });

  test('shows the selected node’s details and the raw plan', async ({ connections, editor, plan, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice')" });

    await editor.setSql(`SELECT * FROM ${table};`);
    await plan.explain();

    await plan.selectNode(0);
    await expect(plan.detailsTitle).toBeVisible();
    expect(await plan.detailFields()).not.toHaveLength(0);

    await plan.toggleRaw();
    await expect(plan.raw).toBeVisible();
    await expect(plan.raw).toContainText('Node Type');
  });

  test('collapses and expands the tree', async ({ connections, editor, plan, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice')" });

    await editor.setSql(`SELECT COUNT(*) FROM ${table};`);
    await plan.explain();
    const expanded = await plan.rows.count();
    expect(expanded).toBeGreaterThan(1);

    await plan.toggleFirstNode();
    await expect(plan.rows).toHaveCount(1);
    await plan.toggleFirstNode();
    await expect(plan.rows).toHaveCount(expanded);
  });

  test('running a query replaces the plan with results', async ({ connections, editor, plan, results, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice')" });

    await editor.setSql(`SELECT * FROM ${table};`);
    await plan.explain();
    await expect(results.grid).toBeHidden();

    await editor.runAll();
    await results.waitForRows();
    await expect(plan.view).toBeHidden();
    await expect(results.cell(0, 0)).toHaveText('1');
  });

  test('a failed explain reports the error instead of a plan', async ({ app, connections, editor, plan }) => {
    await connections.createAndConnect(POSTGRES);

    await editor.setSql('SELECT * FROM definitely_missing_table_e2e;');
    await plan.clickExplain();
    await expect(app.status).toHaveClass(/error/);
    await expect(plan.view).toBeHidden();
  });

  for (const db of ALL_DATABASES) {
    test(`a typed EXPLAIN shows the plan viewer: ${db.label}`, async ({ connections, editor, plan, results, seed }) => {
      await connections.createAndConnect(db);
      const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice')" });
      const explain = db.key === 'sqlite' ? 'EXPLAIN QUERY PLAN' : 'EXPLAIN';

      await editor.run(`${explain} SELECT * FROM ${table} WHERE id = 1;`);
      await plan.waitForPlan();
      await expect(results.grid).toBeHidden();
      expect(await plan.nodeLabels()).not.toHaveLength(0);
    });
  }

  test('a typed EXPLAIN ANALYZE reports measured values', async ({ connections, editor, plan, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice')" });

    await editor.run(`EXPLAIN ANALYZE SELECT * FROM ${table};`);
    await plan.waitForPlan();
    await expect(plan.badge).toHaveText('Measured');
  });

  test('a script mixes grids and plans across tabs', async ({ connections, editor, plan, results, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice')" });

    await editor.run(`SELECT * FROM ${table}; EXPLAIN SELECT * FROM ${table}; SELECT COUNT(*) FROM ${table};`);
    await expect.poll(() => results.resultTabCount()).toBe(3);

    await results.selectResultTab(0);
    await expect(results.grid).toBeVisible();
    await expect(plan.view).toBeHidden();

    await results.selectResultTab(1);
    await expect(plan.view).toBeVisible();
    expect(await plan.nodeLabels()).not.toHaveLength(0);

    await results.selectResultTab(2);
    await expect(results.grid).toBeVisible();
    await expect(plan.view).toBeHidden();
  });

  // A named format means the user wants raw output.
  test('an explicitly formatted EXPLAIN stays a grid', async ({ connections, editor, plan, results, seed }) => {
    await connections.createAndConnect(POSTGRES);
    const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice')" });

    await editor.run(`EXPLAIN (FORMAT TEXT) SELECT * FROM ${table};`);
    await results.waitForRows();
    await expect(plan.view).toBeHidden();
  });

  test('SQLite offers no measured plan', async ({ connections, editor, plan, seed }) => {
    await connections.createAndConnect(SQLITE);
    const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice')" });

    await editor.setSql(`SELECT * FROM ${table};`);
    await plan.explain();

    expect(await plan.canAnalyze()).toBe(false);
    expect(await plan.metricColumns()).toEqual([]);
    await expect(plan.notes.filter({ hasText: 'SQLite' })).toBeVisible();

    // Unbound, so the key does nothing.
    await plan.page.keyboard.press('ControlOrMeta+Shift+A');
    await expect(plan.badge).toHaveText('Estimated');
  });

  // Bytecode, not a plan: the rows belong in the grid.
  test('SQLite bare EXPLAIN keeps its bytecode rows', async ({ connections, editor, plan, results, seed }) => {
    await connections.createAndConnect(SQLITE);
    const table = await seed.table('plan', { insert: "(id, name) VALUES (1, 'Alice')" });

    await editor.run(`EXPLAIN SELECT * FROM ${table};`);
    await results.waitForRows();
    await expect(plan.view).toBeHidden();
  });
});
