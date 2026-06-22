import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

// Isolated app data (connections, tabs, SQLite file). Reset every run.
const dataDir = path.join(e2eDir, 'XenSQL-data');

// Wails v3 server mode (HTTP + WebSocket, no native window) lets a real browser
// drive the Go backend. 8080 is the Wails server default.
const serverPort = process.env.WAILS_SERVER_PORT ?? '8080';
const baseURL = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  testDir: './specs',
  // One shared app + database stack, so tests run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Server-mode WebSocket events arrive unordered, so streamed-result tests
  // occasionally need a re-run.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Opt-in `PW_SLOWMO=400` slows each action to follow a headed run; no-op headless.
    launchOptions: { slowMo: process.env.PW_SLOWMO ? Number(process.env.PW_SLOWMO) : undefined },
  },
  // Brings the database stack up before any test connects.
  globalSetup: './global-setup.ts',
  // Builds frontend then starts the server-mode binary; build + first WSL module
  // download can be slow, hence the generous timeout.
  webServer: {
    command: 'npm run e2e:server',
    url: `${baseURL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      XENSQL_DATA_DIR: dataDir,
      WAILS_SERVER_HOST: '127.0.0.1',
      WAILS_SERVER_PORT: serverPort,
    },
  },
});
