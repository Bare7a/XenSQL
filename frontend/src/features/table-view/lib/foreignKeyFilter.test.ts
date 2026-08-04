import { describe, expect, it } from 'vitest';
import { buildForeignKeyFilter, foreignKeyTargetsFrom } from '@/features/table-view/lib/foreignKeyFilter';
import type { ColumnInfo } from '@/types';

const col = (patch: Partial<ColumnInfo>): ColumnInfo => ({
  name: 'c',
  dataType: 'integer',
  isNullable: true,
  isPrimary: false,
  isForeign: false,
  ...patch,
});

describe('foreignKeyTargetsFrom', () => {
  it('maps foreign key columns to their target', () => {
    expect(
      foreignKeyTargetsFrom([
        col({ name: 'id', isPrimary: true }),
        col({ name: 'author_id', isForeign: true, foreignTable: 'authors', foreignColumn: 'id' }),
      ]),
    ).toEqual({ author_id: { table: 'authors', column: 'id' } });
  });

  it('keeps an empty target column when the FK references the primary key implicitly', () => {
    expect(foreignKeyTargetsFrom([col({ name: 'author_id', isForeign: true, foreignTable: 'authors' })])).toEqual({
      author_id: { table: 'authors', column: '' },
    });
  });

  it('skips columns flagged foreign without a target table', () => {
    expect(foreignKeyTargetsFrom([col({ name: 'author_id', isForeign: true })])).toEqual({});
  });
});

describe('buildForeignKeyFilter', () => {
  it('builds an equality condition for numbers', () => {
    expect(buildForeignKeyFilter('id', 1, 'postgres')).toBe('id = 1');
  });

  it('quotes string values', () => {
    expect(buildForeignKeyFilter('code', 'ab', 'postgres')).toBe("code = 'ab'");
  });

  it('escapes quotes inside string values', () => {
    expect(buildForeignKeyFilter('name', "O'Brien", 'postgres')).toBe("name = 'O''Brien'");
  });

  it('quotes numeric-looking strings, so text keys keep their exact value', () => {
    expect(buildForeignKeyFilter('code', '007', 'postgres')).toBe("code = '007'");
  });

  it('emits boolean keywords', () => {
    expect(buildForeignKeyFilter('flag', true, 'postgres')).toBe('flag = TRUE');
    expect(buildForeignKeyFilter('flag', false, 'postgres')).toBe('flag = FALSE');
  });

  it('renders bigint values unquoted', () => {
    expect(buildForeignKeyFilter('id', 9007199254740993n, 'postgres')).toBe('id = 9007199254740993');
  });

  it('uses IS NULL for null values', () => {
    expect(buildForeignKeyFilter('id', null, 'postgres')).toBe('id IS NULL');
  });

  it('quotes identifiers that need it, per driver', () => {
    expect(buildForeignKeyFilter('order', 1, 'postgres')).toBe('"order" = 1');
    expect(buildForeignKeyFilter('order', 1, 'mysql')).toBe('`order` = 1');
    expect(buildForeignKeyFilter('user id', 1, 'sqlite')).toBe('"user id" = 1');
  });
});
