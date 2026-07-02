import type { AppPage } from '../pages/app-page';
import type { EditorPage } from '../pages/editor-page';
import type { SchemaPage } from '../pages/schema-page';
import type { TableViewPage } from '../pages/table-view-page';

let counter = 0;

/** Short, SQL-safe identifier (e.g. table names), unique within a run. */
export function uniqueIdent(prefix = 'e2e'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`.toLowerCase();
}

/** The standard seeded schema: `id` at column position 0, `name` at position 1. */
export const DEFAULT_COLUMNS = '(id INTEGER PRIMARY KEY, name VARCHAR(50))';

export interface SeedTableOptions {
  /** Column DDL, parens included. Default: {@link DEFAULT_COLUMNS}. */
  columns?: string;
  /** INSERT tail after the table name, e.g. `(id, name) VALUES (1, 'Alice')`. No insert when omitted. */
  insert?: string;
}

/**
 * Seeds tables through the app itself (editor + schema browser) - the same path a user
 * takes. Keep the SQL portable: matrix tests run these statements against all four drivers.
 */
export class Seeder {
  constructor(
    private readonly app: AppPage,
    private readonly editor: EditorPage,
    private readonly schema: SchemaPage,
    private readonly tableView: TableViewPage,
  ) {}

  /** CREATE (and optionally INSERT into) a uniquely-named table. Returns the table name. */
  async table(prefix: string, opts: SeedTableOptions = {}): Promise<string> {
    const name = uniqueIdent(prefix);
    await this.editor.run(`CREATE TABLE ${name} ${opts.columns ?? DEFAULT_COLUMNS};`);
    await this.app.expectStatementApplied();
    if (opts.insert) {
      await this.editor.run(`INSERT INTO ${name} ${opts.insert};`);
      await this.app.expectStatementApplied();
    }
    return name;
  }

  /**
   * Seed a table, refresh the schema panel and open the table in the data browser.
   * Waits for rows, so seed at least one (compose table() + schema.browseTable() for
   * an empty table).
   */
  async browseTable(prefix: string, opts: SeedTableOptions = {}): Promise<string> {
    const name = await this.table(prefix, opts);
    await this.schema.refresh();
    await this.schema.browseTable(name);
    await this.tableView.waitForRows();
    return name;
  }
}
