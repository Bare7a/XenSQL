import type { DbConfig } from '@support/databases';

const env = (key: string, fallback: string): string => process.env[key] ?? fallback;
const envNum = (key: string, fallback: number): number => Number(process.env[key] ?? fallback);

/**
 * Demo targets: the docker-compose Postgres, with `forum` restored by `global-setup.ts`.
 * Override with XENSQL_SCREENSHOT_PG_*.
 */
const host = env('XENSQL_SCREENSHOT_PG_HOST', env('XENSQL_E2E_PG_HOST', '127.0.0.1'));
const port = envNum('XENSQL_SCREENSHOT_PG_PORT', envNum('XENSQL_E2E_PG_PORT', 55432));
const username = env('XENSQL_SCREENSHOT_PG_USER', env('XENSQL_E2E_PG_USER', 'postgres'));
const password = env('XENSQL_SCREENSHOT_PG_PASSWORD', env('XENSQL_E2E_PG_PASSWORD', 'postgres'));

/** Where `global-setup.ts` restores the dump; every demo connection points here. */
export const SCREENSHOT_PG = { host, port, username, password } as const;

/** Green Forum connection (writable) - used for most README tabs. */
export const FORUM: DbConfig = {
  key: 'postgres',
  label: 'Forum',
  driver: 'postgres',
  network: true,
  host,
  port,
  database: env('XENSQL_SCREENSHOT_PG_DB', 'forum'),
  username,
  password,
};

/** Red readonly Postgres - the "Query 1 - Postgres" tab in every shot. */
export const POSTGRES_READONLY: DbConfig = {
  key: 'postgres',
  label: 'Postgres',
  driver: 'postgres',
  network: true,
  host,
  port,
  database: env('XENSQL_SCREENSHOT_PG_DEMO_DB', 'postgres'),
  username,
  password,
};

/** Blue Postgres under Development (screenshot 7 connection list only). */
export const POSTGRES_DEV: DbConfig = {
  key: 'postgres',
  label: 'Postgres',
  driver: 'postgres',
  network: true,
  host,
  port,
  database: env('XENSQL_SCREENSHOT_PG_DEMO_DB', 'postgres'),
  username,
  password,
};

/** Demo color swatches (DEFAULT_COLORS indices). */
export const COLOR = {
  red: '#ef4444', // index 0 - readonly Postgres
  green: '#22c55e', // index 5 - Forum
  blue: '#3b82f6', // index 9 - Development Postgres / new-connection dialog
} as const;

export const COLOR_INDEX = { red: 0, green: 5, blue: 9 } as const;

/** Matches README screenshot size (16:9). */
export const SCREENSHOT_VIEWPORT = { width: 2048, height: 1152 } as const;
