// Database matrix the E2E suite runs against. Network drivers come from
// docker-compose.yml; SQLite uses a file inside the E2E data directory (a path
// relative to the server's working directory, which is the repo root both natively
// and under WSL, so it resolves the same everywhere).

export type DriverKey = 'postgres' | 'mysql' | 'mariadb' | 'sqlite';

// The value selected in the connection dialog's driver <select>. MariaDB speaks the
// MySQL wire protocol, so it uses the same 'mysql' driver.
export type DialogDriver = 'postgres' | 'mysql' | 'sqlite';

export interface DbConfig {
  key: DriverKey;
  /** Base name shown in the connection dialog / switcher. */
  label: string;
  driver: DialogDriver;
  network: boolean;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  /** SQLite only: path typed into the dialog (relative to the server cwd). */
  filePath?: string;
}

const env = (key: string, fallback: string): string => process.env[key] ?? fallback;
const envNum = (key: string, fallback: number): number => Number(process.env[key] ?? fallback);

export const POSTGRES: DbConfig = {
  key: 'postgres',
  label: 'E2E Postgres',
  driver: 'postgres',
  network: true,
  host: env('XENSQL_E2E_PG_HOST', '127.0.0.1'),
  port: envNum('XENSQL_E2E_PG_PORT', 55432),
  database: env('XENSQL_E2E_PG_DB', 'xensql_test'),
  username: env('XENSQL_E2E_PG_USER', 'postgres'),
  password: env('XENSQL_E2E_PG_PASSWORD', 'postgres'),
};

export const MYSQL: DbConfig = {
  key: 'mysql',
  label: 'E2E MySQL',
  driver: 'mysql',
  network: true,
  host: env('XENSQL_E2E_MYSQL_HOST', '127.0.0.1'),
  port: envNum('XENSQL_E2E_MYSQL_PORT', 33306),
  database: env('XENSQL_E2E_MYSQL_DB', 'xensql_test'),
  username: env('XENSQL_E2E_MYSQL_USER', 'root'),
  password: env('XENSQL_E2E_MYSQL_PASSWORD', 'root'),
};

export const MARIADB: DbConfig = {
  key: 'mariadb',
  label: 'E2E MariaDB',
  driver: 'mysql',
  network: true,
  host: env('XENSQL_E2E_MARIADB_HOST', '127.0.0.1'),
  port: envNum('XENSQL_E2E_MARIADB_PORT', 33307),
  database: env('XENSQL_E2E_MARIADB_DB', 'xensql_test'),
  username: env('XENSQL_E2E_MARIADB_USER', 'root'),
  password: env('XENSQL_E2E_MARIADB_PASSWORD', 'root'),
};

export const SQLITE: DbConfig = {
  key: 'sqlite',
  label: 'E2E SQLite',
  driver: 'sqlite',
  network: false,
  filePath: env('XENSQL_E2E_SQLITE_PATH', 'XenSQL-data-e2e/e2e.sqlite'),
};

/** Every supported driver. */
export const ALL_DATABASES: DbConfig[] = [POSTGRES, MYSQL, MARIADB, SQLITE];

/** Network drivers only (host/port based). */
export const NETWORK_DATABASES: DbConfig[] = [POSTGRES, MYSQL, MARIADB];

let counter = 0;

/** A short, SQL-safe unique identifier (e.g. for table names) unique within a run. */
export function uniqueIdent(prefix = 'e2e'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`.toLowerCase();
}
