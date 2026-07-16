import { describe, expect, it } from 'vitest';
import { buildQualifiedTable, quoteIdent } from '@/features/editor/lib/sqlQuoting';

describe('quoteIdent', () => {
  it('uses double quotes for postgres and sqlite', () => {
    expect(quoteIdent('postgres', 'users')).toBe('"users"');
    expect(quoteIdent('sqlite', 'users')).toBe('"users"');
  });
  it('uses backticks for mysql', () => {
    expect(quoteIdent('mysql', 'users')).toBe('`users`');
  });
  it('escapes embedded quotes', () => {
    expect(quoteIdent('postgres', 'a"b')).toBe('"a""b"');
    expect(quoteIdent('mysql', 'a`b')).toBe('`a``b`');
  });
});

describe('buildQualifiedTable', () => {
  it('joins schema and table for non-default schemas', () => {
    expect(buildQualifiedTable('postgres', 'public', 'users')).toBe('"public"."users"');
    expect(buildQualifiedTable('mysql', 'shop', 'orders')).toBe('`shop`.`orders`');
  });
  it('drops the schema for sqlite default ("main") and empty schema', () => {
    expect(buildQualifiedTable('sqlite', 'main', 'users')).toBe('"users"');
    expect(buildQualifiedTable('sqlite', '', 'users')).toBe('"users"');
    expect(buildQualifiedTable('postgres', '', 'users')).toBe('"users"');
  });
});
