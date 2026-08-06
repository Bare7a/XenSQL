import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSTGRES } from './support/databases';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(e2eDir, '..');
const compose = process.env.COMPOSE ?? 'docker compose';
const dumpPath = path.join(e2eDir, 'support', 'forum.dump.sql');

const host = POSTGRES.host as string;
const port = POSTGRES.port as number;
const user = POSTGRES.username as string;
const password = POSTGRES.password as string;
const forumDb = process.env.XENSQL_SCREENSHOT_PG_DB ?? 'forum';

function probePort(h: string, p: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: h, port: p });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1_000, () => done(false));
  });
}

async function waitForPort(h: string, p: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(h, p)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function pgEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PGPASSWORD: password };
}

function runPsql(args: string[], stdin?: string): void {
  // Prefer docker exec against the compose postgres service (no local psql required).
  const container = process.env.XENSQL_SCREENSHOT_PG_CONTAINER;
  if (container) {
    const cmd = ['exec', '-i', '-e', `PGPASSWORD=${password}`, container, 'psql', '-U', user, ...args];
    execFileSync('docker', cmd, {
      input: stdin,
      stdio: stdin === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
      env: pgEnv(),
    });
    return;
  }

  // Fall back to composing against the published port via docker compose exec.
  const composeArgs = [
    ...compose.split(/\s+/),
    'exec',
    '-T',
    '-e',
    `PGPASSWORD=${password}`,
    'postgres',
    'psql',
    '-U',
    user,
    ...args,
  ];
  execFileSync(composeArgs[0], composeArgs.slice(1), {
    cwd: rootDir,
    input: stdin,
    stdio: stdin === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    env: pgEnv(),
  });
}

/**
 * Brings up the e2e Postgres service and restores `forum.dump.sql` into a dedicated
 * `forum` database for README screenshot captures.
 */
export default async function globalSetup(): Promise<void> {
  if (!fs.existsSync(dumpPath)) {
    throw new Error(
      `Missing ${dumpPath}. Create it with a trimmed Forum dump (≤500 rows/table) under e2e/support/.`,
    );
  }

  if (!(await probePort(host, port))) {
    execSync(`${compose} up -d --wait postgres`, { cwd: rootDir, stdio: 'inherit' });
    const ready = await waitForPort(host, port, 120_000);
    if (!ready) {
      throw new Error(
        `Postgres is not reachable at ${host}:${port}. Is Docker running? Try "${compose} up -d --wait postgres".`,
      );
    }
  }

  // Recreate the forum DB from the dump each run so screenshots stay reproducible.
  runPsql(['-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS ${forumDb};`]);
  runPsql(['-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${forumDb};`]);

  // pg_dump 18 may emit \\restrict / \\unrestrict and SET transaction_timeout
  // (PG 17+); strip those so restore works on the e2e Postgres 16 image.
  const sql = fs
    .readFileSync(dumpPath, 'utf8')
    .split(/\r?\n/)
    .filter(
      (line) =>
        !line.startsWith('\\restrict') &&
        !line.startsWith('\\unrestrict') &&
        !/^SET\s+transaction_timeout\b/i.test(line),
    )
    .join('\n');

  console.log(`[screenshots] Restoring ${dumpPath} into ${forumDb}…`);
  runPsql(['-d', forumDb, '-v', 'ON_ERROR_STOP=1'], sql);
  console.log('[screenshots] Forum database ready.');
}
