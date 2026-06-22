import { test as base, expect } from '@playwright/test';
import { AppPage } from './pages/app-page';
import { CellViewerPage } from './pages/cell-viewer-page';
import { ConnectionsPage } from './pages/connections-page';
import { EditorPage } from './pages/editor-page';
import { JsonViewerPage } from './pages/json-viewer-page';
import { QueriesPage } from './pages/queries-page';
import { ResultsPage } from './pages/results-page';
import { SchemaPage } from './pages/schema-page';
import { TableViewPage } from './pages/table-view-page';
import { TabsPage } from './pages/tabs-page';

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
}

export const test = base.extend<Fixtures>({
  // Root fixture: each test gets a fresh page (Playwright isolates context/localStorage).
  app: async ({ page }, use) => {
    const app = new AppPage(page);
    await app.goto();
    await use(app);
    // Reset on exit, not entry: clearing the shared backend here leaves the next test's fresh
    // load clean (no stale session/connections to preload → no "connection not found"). An entry
    // reset is redundant (fresh page) and slow (it runs on the already-clean backend).
    await app.resetState().catch(() => {});
  },
  // Page objects depend on `app` so navigation + reset always run first.
  connections: async ({ page, app }, use) => {
    void app;
    await use(new ConnectionsPage(page));
  },
  editor: async ({ page, app }, use) => {
    void app;
    await use(new EditorPage(page));
  },
  results: async ({ page, app }, use) => {
    void app;
    await use(new ResultsPage(page));
  },
  schema: async ({ page, app }, use) => {
    void app;
    await use(new SchemaPage(page));
  },
  tableView: async ({ page, app }, use) => {
    void app;
    await use(new TableViewPage(page));
  },
  queries: async ({ page, app }, use) => {
    void app;
    await use(new QueriesPage(page));
  },
  tabs: async ({ page, app }, use) => {
    void app;
    await use(new TabsPage(page));
  },
  jsonViewer: async ({ page, app }, use) => {
    void app;
    await use(new JsonViewerPage(page));
  },
  cellViewer: async ({ page, app }, use) => {
    void app;
    await use(new CellViewerPage(page));
  },
});

export { expect };
