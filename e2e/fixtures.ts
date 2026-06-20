import { test as base, expect } from '@playwright/test';
import { AppPage } from './pages/app-page';
import { ConnectionsPage } from './pages/connections-page';
import { EditorPage } from './pages/editor-page';
import { QueriesPage } from './pages/queries-page';
import { ResultsPage } from './pages/results-page';
import { SchemaPage } from './pages/schema-page';
import { TableViewPage } from './pages/table-view-page';

interface Fixtures {
  app: AppPage;
  connections: ConnectionsPage;
  editor: EditorPage;
  results: ResultsPage;
  schema: SchemaPage;
  tableView: TableViewPage;
  queries: QueriesPage;
}

export const test = base.extend<Fixtures>({
  // The root fixture: every test navigates to a freshly hydrated app and starts
  // from a clean backend (no leftover connections from prior tests). Playwright
  // already isolates localStorage per test via a fresh browser context.
  app: async ({ page }, use) => {
    const app = new AppPage(page);
    await app.goto();
    await app.resetState();
    await use(app);
  },
  // The page objects below depend on `app` so navigation + reset always run first.
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
});

export { expect };
