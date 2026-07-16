import { describe, expect, it } from 'vitest';
import { collectSchemaDiagnostics } from '@/features/editor/lib/sqlDiagnostics';
import type { SchemaInfo, TableInfo } from '@/types';

const schemas: SchemaInfo[] = [{ name: 'public' }];
const tables: TableInfo[] = [
  { schema: 'public', name: 'users', type: 'table' },
  { schema: 'public', name: 'orders', type: 'table' },
];

const diags = (sql: string, driver: 'postgres' | 'mysql' | 'sqlite' = 'postgres') =>
  collectSchemaDiagnostics(sql, tables, schemas, driver);

describe('collectSchemaDiagnostics', () => {
  it('flags an unknown table with its exact source span', () => {
    const sql = 'SELECT * FROM userz WHERE id = 1';
    const out = diags(sql);
    expect(out).toHaveLength(1);
    expect(out[0].message).toBe('Unknown table "userz"');
    expect(sql.slice(out[0].start, out[0].end)).toBe('userz');
  });

  it('does not flag known tables, case-insensitively', () => {
    expect(diags('SELECT * FROM users JOIN orders o ON o.id = users.id')).toEqual([]);
    expect(diags('SELECT * FROM USERS')).toEqual([]);
  });

  it('does not flag CTE names or a schema qualifier being typed', () => {
    expect(diags('WITH recent AS (SELECT 1) SELECT * FROM recent')).toEqual([]);
    expect(diags('SELECT * FROM public.')).toEqual([]);
  });

  it('flags unknown write targets and schema-qualified misses', () => {
    expect(diags('INSERT INTO userz (id) VALUES (1)')[0]?.message).toBe('Unknown table "userz"');
    expect(diags('UPDATE userz SET x = 1')[0]?.message).toBe('Unknown table "userz"');
    const out = diags('SELECT * FROM public.userz');
    expect(out).toHaveLength(1);
    expect(out[0].message).toBe('Unknown table "userz"');
  });

  it('keeps offsets absolute across multiple statements', () => {
    const sql = 'SELECT * FROM users;\nSELECT * FROM ghost;';
    const out = diags(sql);
    expect(out).toHaveLength(1);
    expect(sql.slice(out[0].start, out[0].end)).toBe('ghost');
  });

  it('ignores tables mentioned in comments and strings', () => {
    expect(diags("SELECT * FROM users -- FROM phantom\nWHERE note = 'from ghost'")).toEqual([]);
  });

  it('handles quoted identifiers', () => {
    const capTables: TableInfo[] = [{ schema: 'public', name: 'Users', type: 'table' }];
    const sql = 'SELECT * FROM "Userz"';
    const out = collectSchemaDiagnostics(sql, capTables, schemas, 'postgres');
    expect(out).toHaveLength(1);
    expect(sql.slice(out[0].start, out[0].end)).toBe('"Userz"');
    expect(collectSchemaDiagnostics('SELECT * FROM "Users"', capTables, schemas, 'postgres')).toEqual([]);
  });
});
