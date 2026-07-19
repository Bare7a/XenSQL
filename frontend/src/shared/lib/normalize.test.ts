import { describe, expect, it } from 'vitest';
import {
  formatError,
  normalizeColumns,
  normalizeConnectionStatus,
  normalizeHistory,
  normalizeQueryResult,
  normalizeSavedQueries,
  normalizeSchemaBundle,
  normalizeSchemas,
  normalizeTables,
  toArray,
  uniquifyColumns,
} from '@/shared/lib/normalize';

describe('toArray', () => {
  it('passes arrays through', () => {
    expect(toArray([1, 2])).toEqual([1, 2]);
  });
  it('returns [] for null/undefined/non-array', () => {
    expect(toArray(null)).toEqual([]);
    expect(toArray(undefined)).toEqual([]);
    expect(toArray({})).toEqual([]);
    expect(toArray('hi')).toEqual([]);
  });
});

describe('normalizeSchemas', () => {
  it('keeps only items with names', () => {
    expect(normalizeSchemas([{ name: 'a' }, { name: '' }, { name: 'b' }])).toEqual([{ name: 'a' }, { name: 'b' }]);
  });
  it('coerces non-string names', () => {
    expect(normalizeSchemas([{ name: 42 }])).toEqual([{ name: '42' }]);
  });
});

describe('normalizeTables', () => {
  it('defaults missing type to "table"', () => {
    expect(normalizeTables([{ schema: 's', name: 'n' }])).toEqual([{ schema: 's', name: 'n', type: 'table' }]);
  });
});

describe('normalizeColumns', () => {
  it('preserves boolean flags and optional defaultVal', () => {
    expect(normalizeColumns([{ name: 'id', dataType: 'INT', isPrimary: true, isNullable: false }])).toEqual([
      { name: 'id', dataType: 'INT', isNullable: false, isPrimary: true, isForeign: false, defaultVal: undefined },
    ]);
  });
});

describe('normalizeConnectionStatus', () => {
  it('fills defaults for missing fields', () => {
    expect(normalizeConnectionStatus(null)).toEqual({
      connected: false,
      database: '',
      schema: '',
      user: '',
      host: undefined,
    });
  });
  it('preserves host when provided', () => {
    expect(normalizeConnectionStatus({ host: 'h', connected: true })).toEqual({
      connected: true,
      database: '',
      schema: '',
      user: '',
      host: 'h',
    });
  });
});

describe('normalizeSchemaBundle', () => {
  it('coerces malformed payloads into the expected shape', () => {
    expect(normalizeSchemaBundle(null)).toEqual({
      status: {
        connected: false,
        database: '',
        schema: '',
        user: '',
        host: undefined,
      },
      schemas: [],
      loadedTables: [],
    });
  });
  it('normalizes loadedTables entries', () => {
    const out = normalizeSchemaBundle({
      loadedTables: [{ schema: 'public', tables: [{ name: 'users' }] }],
    });
    expect(out.loadedTables).toEqual([{ schema: 'public', tables: [{ schema: '', name: 'users', type: 'table' }] }]);
  });
});

describe('normalizeHistory', () => {
  it('coerces numbers and booleans', () => {
    expect(normalizeHistory([{ id: 'x', durationMs: '12', success: 1 }])).toEqual([
      {
        id: 'x',
        connectionId: '',
        sql: '',
        executedAt: '',
        durationMs: 12,
        success: true,
        error: undefined,
      },
    ]);
  });
});

describe('normalizeSavedQueries', () => {
  it('keeps connectionId only when present', () => {
    expect(normalizeSavedQueries([{ id: 'a', name: 'q' }])).toEqual([
      {
        id: 'a',
        name: 'q',
        connectionId: undefined,
        sql: '',
        createdAt: '',
        updatedAt: '',
      },
    ]);
  });
});

describe('normalizeQueryResult', () => {
  it('fills null slice fields from non-SELECT Wails payloads', () => {
    const out = normalizeQueryResult({
      columns: null as unknown as string[],
      columnTypes: null as unknown as string[],
      rows: null as unknown as unknown[][],
      primaryKeys: null as unknown as string[],
      rowCount: 0,
      affectedRows: 1,
      durationMs: 5,
      message: '1 row(s) affected',
    });
    expect(out).toEqual({
      columns: [],
      columnTypes: [],
      rows: [],
      primaryKeys: [],
      rowCount: 0,
      affectedRows: 1,
      durationMs: 5,
      message: '1 row(s) affected',
    });
  });
});

describe('uniquifyColumns', () => {
  it('leaves already-unique names unchanged', () => {
    expect(uniquifyColumns(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
  it('suffixes duplicate names (e.g. SELECT a.id, b.id)', () => {
    expect(uniquifyColumns(['id', 'id', 'name', 'id'])).toEqual(['id', 'id_2', 'name', 'id_3']);
  });
  it('avoids colliding with an existing suffixed name', () => {
    expect(uniquifyColumns(['id', 'id', 'id_2'])).toEqual(['id', 'id_2', 'id_2_2']);
  });
});

describe('normalizeQueryResult disambiguates duplicate columns', () => {
  it('renames repeated names so selection/sort/JSON stay consistent', () => {
    const out = normalizeQueryResult({
      columns: ['id', 'id'],
      columnTypes: ['int', 'int'],
      rows: [[1, 2]],
      primaryKeys: [],
      rowCount: 1,
      affectedRows: 0,
      durationMs: 0,
    });
    expect(out?.columns).toEqual(['id', 'id_2']);
  });
});

describe('formatError', () => {
  it('handles strings, Errors and objects with .message', () => {
    expect(formatError('boom')).toBe('boom');
    expect(formatError(new Error('nope'))).toBe('nope');
    expect(formatError({ message: 'huh' })).toBe('huh');
  });

  it('unwraps the Wails JSON error envelope to its inner message', () => {
    const envelope = JSON.stringify({
      message: 'failed to connect: database "Schemes2" does not exist (SQLSTATE 3D000)',
      cause: null,
      kind: 'RuntimeError',
    });
    const expected = 'failed to connect: database "Schemes2" does not exist (SQLSTATE 3D000)';
    // Whether raw string or wrapped in an Error, we get the message.
    expect(formatError(envelope)).toBe(expected);
    expect(formatError(new Error(envelope))).toBe(expected);
  });

  it('leaves plain messages and non-envelope JSON-ish text untouched', () => {
    expect(formatError('relation "x" does not exist')).toBe('relation "x" does not exist');
    // Not an envelope (no string .message) - must not be mangled.
    expect(formatError('{"foo":1}')).toBe('{"foo":1}');
  });
});
