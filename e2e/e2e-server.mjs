// Launches XenSQL in Wails v3 server mode for the Playwright suite.
//
//   1. Reset the dedicated E2E data directory (this process owns it for the run).
//   2. Build the frontend and stage it into cmd/e2e-server/dist for embedding.
//   3. Start the server-mode binary.
//
// Playwright waits on GET /health, so this just starts the server in the foreground.
import { execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(e2eDir);
const frontendDir = path.join(rootDir, 'frontend');
const serverDist = path.join(rootDir, 'cmd', 'e2e-server', 'dist');

const dataDir = process.env.XENSQL_DATA_DIR ?? path.join(e2eDir, 'XenSQL-data');
const serverHost = process.env.WAILS_SERVER_HOST ?? '127.0.0.1';
const serverPort = process.env.WAILS_SERVER_PORT ?? '8080';

// 1. Fresh data directory so tests start from a known-empty state.
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

// 2. Build the frontend and copy it into the embed directory.
console.log('[e2e-server] building frontend (build:dev)...');
execSync('npm run build:dev', { cwd: frontendDir, stdio: 'inherit' });

console.log('[e2e-server] staging assets into cmd/e2e-server/dist...');
stageDist();

// 3. Start the server.
const child = startServer();

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

function stageDist() {
  const builtDist = path.join(frontendDir, 'dist');
  if (!existsSync(builtDist)) {
    throw new Error(`Frontend build produced no output at ${builtDist}`);
  }
  rmSync(serverDist, { recursive: true, force: true });
  mkdirSync(serverDist, { recursive: true });
  cpSync(builtDist, serverDist, { recursive: true });
}

function startServer() {
  console.log(`[e2e-server] starting server mode on ${serverHost}:${serverPort}`);

  return spawn('go', ['run', '-tags', 'server', './cmd/e2e-server'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      XENSQL_DATA_DIR: dataDir,
      WAILS_SERVER_HOST: serverHost,
      WAILS_SERVER_PORT: serverPort,
    },
  });
}
