import { describe, expect, it } from 'vitest';
import { parseQueryContext } from '@/features/editor/lib/sqlQueryParse';
import type { SchemaInfo, TableInfo } from '@/types';

const schemas: SchemaInfo[] = [{ name: 'public' }];
const tables: TableInfo[] = [
  { schema: 'public', name: 'users', type: 'table' },
  { schema: 'public', name: 'orders', type: 'table' },
];

const tableNames = (sql: string, driver: 'postgres' | 'mysql' | 'sqlite' = 'postgres') =>
  parseQueryContext(sql, tables, schemas, driver).queryTables.map((t) => t.table);

describe('comments and strings do not bind phantom tables', () => {
  it('ignores FROM/JOIN inside line comments', () => {
    expect(tableNames('SELECT * FROM users -- JOIN phantom p\nWHERE ')).toEqual(['users']);
    expect(tableNames('-- SELECT * FROM old_table\nSELECT * FROM users WHERE ')).toEqual(['users']);
  });

  it('ignores FROM/JOIN inside block comments', () => {
    expect(tableNames('SELECT * FROM users /* JOIN phantom p */ WHERE ')).toEqual(['users']);
  });

  it('ignores FROM inside string literals', () => {
    expect(tableNames("SELECT * FROM users WHERE note = 'copied from backups' AND ")).toEqual(['users']);
  });

  it('mysql: ignores FROM inside double-quoted strings and # comments', () => {
    expect(tableNames('SELECT * FROM users WHERE name = "John from accounting"', 'mysql')).toEqual(['users']);
    expect(tableNames('SELECT * FROM users # JOIN phantom\nWHERE ', 'mysql')).toEqual(['users']);
  });

  it('still parses quoted-identifier tables', () => {
    const parsed = parseQueryContext('SELECT * FROM "users" u JOIN `orders` o ON ', tables, schemas, 'postgres');
    expect(parsed.queryTables.map((t) => t.table)).toEqual(['users', 'orders']);
    expect(parsed.bindings.get('u')?.table).toBe('users');
  });
});

describe('CTE names vs comments', () => {
  it('does not invent CTEs from a commented-out WITH', () => {
    const parsed = parseQueryContext('-- WITH x AS (SELECT 1)\nSELECT * FROM users', tables, schemas, 'postgres');
    expect(parsed.ctes).toEqual([]);
  });

  it('finds the CTE when a leading comment precedes WITH', () => {
    const parsed = parseQueryContext(
      '-- recent signups\nWITH recent AS (SELECT 1) SELECT * FROM ',
      tables,
      schemas,
      'postgres',
    );
    expect(parsed.ctes).toEqual(['recent']);
  });
});

describe('IS DISTINCT FROM is not a table source', () => {
  it('does not bind the right-hand expression as a table', () => {
    expect(tableNames('SELECT * FROM users WHERE name IS DISTINCT FROM email')).toEqual(['users']);
    expect(tableNames('SELECT * FROM users WHERE name IS NOT DISTINCT FROM email AND ')).toEqual(['users']);
  });

  it('still binds tables after SELECT DISTINCT', () => {
    expect(tableNames('SELECT DISTINCT name FROM users JOIN orders o ON ')).toEqual(['users', 'orders']);
  });
});

describe('write-target bindings', () => {
  it('binds the INSERT INTO target table', () => {
    const parsed = parseQueryContext('INSERT INTO users (id) VALUES (1)', tables, schemas, 'postgres');
    expect(parsed.queryTables.map((t) => t.table)).toEqual(['users']);
    expect(parsed.bindings.get('users')?.table).toBe('users');
  });

  it('binds a schema-qualified INSERT target and REPLACE INTO (mysql)', () => {
    expect(tableNames('INSERT INTO public.orders (id) VALUES (1)')).toEqual(['orders']);
    expect(tableNames('REPLACE INTO orders SET id = 1', 'mysql')).toEqual(['orders']);
  });

  it('keeps binding the UPDATE target', () => {
    expect(tableNames('UPDATE users SET name = 1 WHERE ')).toEqual(['users']);
  });
});
