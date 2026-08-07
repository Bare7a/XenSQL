import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARIADB, MYSQL, POSTGRES } from './support/databases';
import { probePort, waitForPort } from './support/ports';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = process.env.COMPOSE ?? 'docker compose';

// Network databases the suite connects to (see docker-compose.yml).
const services = [POSTGRES, MYSQL, MARIADB].map((db) => ({
  label: db.label,
  host: db.host as string,
  port: db.port as number,
}));

// Data directory is owned/reset by e2e-server.mjs; here we only ensure every
// database server is up and healthy.
export default async function globalSetup() {
  const allUp = (await Promise.all(services.map((s) => probePort(s.host, s.port)))).every(Boolean);
  if (allUp) return;

  // `--wait` blocks until every service's compose healthcheck passes.
  execSync(`${compose} up -d --wait`, { cwd: rootDir, stdio: 'inherit' });

  for (const s of services) {
    const ready = await waitForPort(s.host, s.port, 120_000);
    if (!ready) {
      throw new Error(
        `${s.label} is not reachable at ${s.host}:${s.port} after starting the database stack. ` +
          `Is Docker running? Try "${compose} up -d --wait" manually.`,
      );
    }
  }
}
