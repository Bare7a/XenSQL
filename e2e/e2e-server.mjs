// Launches XenSQL in Wails v3 server mode for the Playwright suite.
//
// Steps:
//   1. Reset the dedicated E2E data directory (this process owns it for the run).
//   2. Build the frontend and stage it into cmd/e2e-server/dist for embedding.
//   3. Start the server-mode binary - natively on Linux/macOS/CI, or via WSL on
//      Windows (Wails v3 server mode does not compile natively on Windows yet).
//
// Playwright's webServer config waits on GET /health, so this only needs to start
// the server and keep it in the foreground.
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

// 1. Fresh data directory every run so tests start from a known-empty state.
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

  if (process.platform === 'win32') {
    // Server mode does not build natively on Windows; run it through WSL instead.
    const wslRoot = toWslPath(rootDir);
    const wslData = toWslPath(dataDir);
    const shellCmd = [
      `cd ${shellQuote(wslRoot)}`,
      `export XENSQL_DATA_DIR=${shellQuote(wslData)}`,
      `export WAILS_SERVER_HOST=${shellQuote(serverHost)}`,
      `export WAILS_SERVER_PORT=${shellQuote(serverPort)}`,
      'go run -tags server ./cmd/e2e-server',
    ].join(' && ');
    return spawn('wsl', ['-e', 'bash', '-lc', shellCmd], { stdio: 'inherit' });
  }

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

function toWslPath(windowsPath) {
  return execSync(`wsl wslpath -u "${windowsPath.replace(/\\/g, '/')}"`, { encoding: 'utf8' }).trim();
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
