import { describe, expect, it } from 'vitest';
import { LruCache } from '@/features/editor/lib/sqlCache';
import { analyzeSqlCursor } from '@/features/editor/lib/sqlContext';
import { parseQueryContext } from '@/features/editor/lib/sqlQueryParse';
import { parseSqlStatements } from '@/features/editor/lib/sqlStatements';
import { tokenizeSql } from '@/features/editor/lib/sqlTokens';
import type { SchemaInfo, TableInfo } from '@/types';

describe('LruCache', () => {
  it('evicts the least recently used entry at capacity', () => {
    const cache = new LruCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // refresh: 'b' is now the oldest
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('overwrites an existing key without growing', () => {
    const cache = new LruCache<number>(2);
    cache.set('a', 1);
    cache.set('a', 2);
    cache.set('b', 3);
    expect(cache.get('a')).toBe(2);
    expect(cache.get('b')).toBe(3);
  });
});

// One keystroke fans out to several providers analyzing the same strings; these must be shared.
describe('per-keystroke analysis is memoized', () => {
  const schemas: SchemaInfo[] = [{ name: 'public' }];
  const tables: TableInfo[] = [{ schema: 'public', name: 'users', type: 'table' }];

  it('tokenizeSql returns the cached tokens for identical text + driver', () => {
    expect(tokenizeSql('SELECT * FROM users', 'postgres')).toBe(tokenizeSql('SELECT * FROM users', 'postgres'));
    expect(tokenizeSql('SELECT * FROM users', 'postgres')).not.toBe(tokenizeSql('SELECT * FROM users', 'mysql'));
  });

  it('analyzeSqlCursor returns the cached analysis for identical before-text', () => {
    expect(analyzeSqlCursor('SELECT * FROM users WHERE ', 'postgres')).toBe(
      analyzeSqlCursor('SELECT * FROM users WHERE ', 'postgres'),
    );
  });

  it('parseSqlStatements returns the cached split for an identical buffer', () => {
    expect(parseSqlStatements('SELECT 1;\nSELECT 2;', 'postgres')).toBe(
      parseSqlStatements('SELECT 1;\nSELECT 2;', 'postgres'),
    );
  });

  it('parseQueryContext hits only while the schema arrays keep their identity', () => {
    const first = parseQueryContext('SELECT * FROM users', tables, schemas, 'postgres');
    expect(parseQueryContext('SELECT * FROM users', tables, schemas, 'postgres')).toBe(first);
    // A schema reload swaps the arrays; equal content is not enough for a hit.
    const reloaded: TableInfo[] = [{ schema: 'public', name: 'users', type: 'table' }];
    expect(parseQueryContext('SELECT * FROM users', reloaded, schemas, 'postgres')).not.toBe(first);
  });
});
