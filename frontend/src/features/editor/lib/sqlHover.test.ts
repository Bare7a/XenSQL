import { describe, expect, it } from 'vitest';
import { analyzeHover, columnHoverLines, tableColumnsMarkdown } from '@/features/editor/lib/sqlHover';
import { parseQueryContext } from '@/features/editor/lib/sqlQueryParse';
import type { ColumnInfo, SchemaInfo, TableInfo } from '@/types';

const schemas: SchemaInfo[] = [{ name: 'public' }];
const tables: TableInfo[] = [
  { schema: 'public', name: 'users', type: 'table' },
  { schema: 'public', name: 'orders', type: 'view' },
];

function hoverAt(sql: string, needle: string, occurrence = 1) {
  let offset = -1;
  for (let i = 0; i < occurrence; i++) offset = sql.indexOf(needle, offset + 1);
  const parsed = parseQueryContext(sql, tables, schemas, 'postgres');
  return analyzeHover(sql, offset, parsed, tables, schemas, 'postgres');
}

describe('analyzeHover', () => {
  it('describes a table with its type and schema', () => {
    const q = hoverAt('SELECT * FROM users WHERE id = 1', 'users');
    expect(q?.lines).toEqual(['**users** · table', 'schema public']);
    const v = hoverAt('SELECT * FROM orders', 'orders');
    expect(v?.lines).toEqual(['**orders** · view', 'schema public']);
  });

  it('spans exactly the hovered token', () => {
    const sql = 'SELECT * FROM users';
    const q = hoverAt(sql, 'users');
    expect(sql.slice(q?.start, q?.end)).toBe('users');
  });

  it('describes an alias as pointing at its table', () => {
    const q = hoverAt('SELECT * FROM users u WHERE u.id = 1', 'u ', 1);
    expect(q?.lines?.[0]).toBe('**u** · alias for users');
  });

  it('requests a column lookup for a qualified column', () => {
    const q = hoverAt('SELECT * FROM users u WHERE u.email = 1', 'email');
    expect(q?.columnLookup).toEqual({ bindings: [{ schema: 'public', table: 'users' }], name: 'email' });
  });

  it('requests a lookup across in-scope tables for a bare column', () => {
    const q = hoverAt('SELECT email FROM users JOIN orders o ON 1=1', 'email');
    expect(q?.columnLookup?.name).toBe('email');
    expect(q?.columnLookup?.bindings.map((b) => b.table).sort()).toEqual(['orders', 'users']);
  });

  it('answers CTE names and their columns without a lookup', () => {
    const sql = 'WITH recent AS (SELECT id, email AS mail FROM users) SELECT * FROM recent WHERE recent.mail = 1';
    expect(hoverAt(sql, 'recent', 2)?.lines).toEqual(['**recent** · CTE', 'columns: id, mail']);
    // 'email' contains 'mail', so the qualified recent.mail is the 3rd occurrence.
    expect(hoverAt(sql, 'mail', 3)?.lines).toEqual(['**mail**', 'column of CTE recent']);
  });

  it('ignores keywords, strings and comments', () => {
    expect(hoverAt('SELECT * FROM users', 'SELECT')).toBeNull();
    expect(hoverAt("SELECT * FROM users WHERE a = 'users'", 'users', 2)).toBeNull();
    expect(hoverAt('SELECT * FROM users -- users note', 'users', 2)).toBeNull();
  });

  it('describes a schema name', () => {
    expect(hoverAt('SELECT * FROM public.users', 'public')?.lines).toEqual(['**public** · schema']);
  });

  it('formats column hover lines from schema metadata', () => {
    const lines = columnHoverLines(
      { name: 'email', dataType: 'text', isNullable: false, isPrimary: false, isForeign: false },
      { schema: 'public', table: 'users' },
    );
    expect(lines).toEqual(['**email** · text · not null', 'column of public.users']);
  });

  // Borrowed from potygen's quick info: a table hover carries its relation so the provider can
  // append the column list.
  it('marks table and alias hovers for a column-list append', () => {
    expect(hoverAt('SELECT * FROM users', 'users')?.tableColumns).toEqual({ schema: 'public', table: 'users' });
    const alias = hoverAt('SELECT * FROM users u WHERE u.id = 1', 'u ', 1);
    expect(alias?.tableColumns).toEqual({ schema: 'public', table: 'users' });
  });

  it('renders the column list as a markdown table, capped', () => {
    const cols: ColumnInfo[] = [
      { name: 'id', dataType: 'int', isNullable: false, isPrimary: true, isForeign: false },
      { name: 'email', dataType: 'text', isNullable: false, isPrimary: false, isForeign: false },
    ];
    expect(tableColumnsMarkdown(cols)).toEqual([
      '| column | type |\n| --- | --- |\n| id | int · PK |\n| email | text · not null |',
    ]);
    expect(tableColumnsMarkdown([])).toEqual([]);

    const many: ColumnInfo[] = Array.from({ length: 35 }, (_, i) => ({
      name: `c${i}`,
      dataType: 'int',
      isNullable: true,
      isPrimary: false,
      isForeign: false,
    }));
    expect(tableColumnsMarkdown(many)[1]).toBe('… 5 more columns');
  });
});
