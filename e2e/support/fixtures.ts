import { test as base, expect, type Page } from '@playwright/test';
import { AppPage } from '../pages/app-page';
import { CellViewerPage } from '../pages/cell-viewer-page';
import { ConnectionsPage } from '../pages/connections-page';
import { EditorPage } from '../pages/editor-page';
import { JsonViewerPage } from '../pages/json-viewer-page';
import { QueriesPage } from '../pages/queries-page';
import { ResultsPage } from '../pages/results-page';
import { SchemaPage } from '../pages/schema-page';
import { TableViewPage } from '../pages/table-view-page';
import { TabsPage } from '../pages/tabs-page';
import { Seeder } from './seed';

interface Fixtures {
  app: AppPage;
  connections: ConnectionsPage;
  editor: EditorPage;
  results: ResultsPage;
  schema: SchemaPage;
  tableView: TableViewPage;
  queries: QueriesPage;
  tabs: TabsPage;
  jsonViewer: JsonViewerPage;
  cellViewer: CellViewerPage;
  seed: Seeder;
}

// Page objects are stateless wrappers around `page`; the auto `app` fixture below
// guarantees navigation has happened before any test body runs.
const pageObject =
  <T>(PageObject: new (page: Page) => T) =>
  async ({ page }: { page: Page }, use: (po: T) => Promise<void>) => {
    await use(new PageObject(page));
  };

export const test = base.extend<Fixtures>({
  // Root fixture, auto so every test navigates first (Playwright isolates context/localStorage).
  app: [
    async ({ page }, use) => {
      const app = new AppPage(page);
      await app.goto();
      await use(app);
      // Reset on exit, not entry: clearing the shared backend here leaves the next test's fresh
      // load clean (no stale session/connections to preload → no "connection not found"). An entry
      // reset is redundant (fresh page) and slow (it runs on the already-clean backend).
      await app.resetState().catch(() => {});
    },
    { auto: true },
  ],
  connections: pageObject(ConnectionsPage),
  editor: pageObject(EditorPage),
  results: pageObject(ResultsPage),
  schema: pageObject(SchemaPage),
  tableView: pageObject(TableViewPage),
  queries: pageObject(QueriesPage),
  tabs: pageObject(TabsPage),
  jsonViewer: pageObject(JsonViewerPage),
  cellViewer: pageObject(CellViewerPage),
  seed: async ({ app, editor, schema, tableView }, use) => {
    await use(new Seeder(app, editor, schema, tableView));
  },
});

export { expect };
