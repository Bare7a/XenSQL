import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

// Isolated app data for UI E2E (connections, tabs, SQLite file). Reset on every run.
const dataDir = path.join(e2eDir, 'XenSQL-data');

// XenSQL runs in Wails v3 server mode for E2E (HTTP + WebSocket, no native window),
// so a real browser can drive the actual Go backend. 8080 is the Wails server default.
const serverPort = process.env.WAILS_SERVER_PORT ?? '8080';
const baseURL = `http://127.0.0.1:${serverPort}`;

export default defineConfig({
  testDir: './specs',
  // The suite shares one app + one database stack, so tests run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // One local / two CI retries: Wails server mode delivers WebSocket events without
  // ordering guarantees, so streamed-result tests can occasionally need a re-run.
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
  },
  // Brings the database stack up (docker compose) before any test connects.
  globalSetup: './global-setup.ts',
  // Builds the frontend, then starts the server-mode binary. The build + first WSL
  // module download can be slow, hence the generous timeout.
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
