import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { SCREENSHOT_VIEWPORT } from './screenshots/screenshot-db';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(e2eDir, 'XenSQL-data-screenshots');

const serverPort = process.env.WAILS_SERVER_PORT ?? '8080';
const baseURL = `http://127.0.0.1:${serverPort}`;

/**
 * Captures the README gallery under `.github/screenshots/`.
 *
 * Starts the e2e Postgres service and restores `screenshots/fixtures/forum.dump.sql`
 * (see `screenshots/global-setup.ts`). Builds the frontend with window chrome enabled.
 *
 *   npm run screenshots
 *   # or: wails3 task screenshots
 */
export default defineConfig({
  testDir: './screenshots',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 300_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    viewport: SCREENSHOT_VIEWPORT,
    launchOptions: {
      slowMo: process.env.PW_SLOWMO ? Number(process.env.PW_SLOWMO) : undefined,
      args: process.env.PW_SINGLE_PROCESS ? ['--single-process', '--no-zygote'] : [],
    },
  },
  globalSetup: './screenshots/global-setup.ts',
  webServer: {
    command: 'npm run e2e:server',
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      XENSQL_DATA_DIR: dataDir,
      WAILS_SERVER_HOST: '127.0.0.1',
      WAILS_SERVER_PORT: serverPort,
      // Show minimize / maximize / close in the in-page title bar (server mode).
      XENSQL_FORCE_WINDOW_CHROME: '1',
    },
  },
});
