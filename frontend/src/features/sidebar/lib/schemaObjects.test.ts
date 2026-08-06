import { describe, expect, it } from 'vitest';
import {
  constraintRows,
  groupKey,
  indexRows,
  routineRows,
  routinesKey,
  triggerRows,
} from '@/features/sidebar/lib/schemaObjects';
import type { ConstraintInfo, IndexInfo, RoutineInfo, TriggerInfo } from '@/types';

const index = (over: Partial<IndexInfo> = {}): IndexInfo => ({
  name: 'idx',
  schema: 'public',
  table: 'users',
  columns: ['email'],
  isPrimary: false,
  isUnique: false,
  ...over,
});

const constraint = (over: Partial<ConstraintInfo> = {}): ConstraintInfo => ({
  name: 'c',
  schema: 'public',
  table: 'users',
  type: 'PRIMARY KEY',
  columns: ['id'],
  ...over,
});

describe('indexRows', () => {
  it('renders columns and carries a DDL ref', () => {
    const [row] = indexRows([index({ name: 'users_email_idx', columns: ['email', 'org_id'] })]);
    expect(row.label).toBe('users_email_idx');
    expect(row.detail).toBe('(email, org_id)');
    expect(row.ref).toEqual({ schema: 'public', name: 'users_email_idx', kind: 'index', table: 'users' });
  });

  it('badges primary before unique', () => {
    expect(indexRows([index({ isPrimary: true, isUnique: true })])[0].badge).toBe('pk');
    expect(indexRows([index({ isUnique: true })])[0].badge).toBe('unique');
    expect(indexRows([index()])[0].badge).toBe('index');
  });

  it('leaves an expression-only index without a column list', () => {
    expect(indexRows([index({ columns: [] })])[0].detail).toBe('');
  });
});

describe('constraintRows', () => {
  it('points a foreign key at its target', () => {
    const [row] = constraintRows([
      constraint({
        name: 'users_org_fk',
        type: 'FOREIGN KEY',
        columns: ['org_id'],
        refTable: 'orgs',
        refColumns: ['id'],
      }),
    ]);
    expect(row.detail).toBe('(org_id) → orgs(id)');
    expect(row.badge).toBe('fk');
    expect(row.ref.kind).toBe('constraint');
  });

  it('falls back to the local columns when the FK target is unknown', () => {
    const [row] = constraintRows([constraint({ type: 'FOREIGN KEY', columns: ['org_id'] })]);
    expect(row.detail).toBe('(org_id)');
  });

  it('shows a check body instead of columns', () => {
    const [row] = constraintRows([constraint({ type: 'CHECK', columns: [], definition: 'CHECK ((age > 0))' })]);
    expect(row.detail).toBe('CHECK ((age > 0))');
    expect(row.badge).toBe('check');
  });

  it('renders primary and unique key columns', () => {
    expect(constraintRows([constraint({ columns: ['a', 'b'] })])[0].detail).toBe('(a, b)');
    expect(constraintRows([constraint({ type: 'UNIQUE' })])[0].badge).toBe('unique');
  });

  it('gives an unrecognised constraint type no badge rather than a wrong one', () => {
    expect(constraintRows([constraint({ type: 'EXCLUDE' })])[0].badge).toBeUndefined();
  });

  it('labels and keys SQLite’s unnamed inline constraints apart', () => {
    const rows = constraintRows([
      constraint({ name: '', type: 'PRIMARY KEY', columns: ['id'] }),
      constraint({ name: '', type: 'FOREIGN KEY', columns: ['org_id'], refTable: 'orgs' }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['PRIMARY KEY', 'FOREIGN KEY']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(rows[0].ref.name).toBe('');
  });
});

describe('triggerRows', () => {
  it('joins timing and events', () => {
    const trigger: TriggerInfo = {
      name: 'users_audit',
      schema: 'public',
      table: 'users',
      timing: 'AFTER',
      events: 'INSERT, UPDATE',
    };
    const [row] = triggerRows([trigger]);
    expect(row.detail).toBe('AFTER INSERT, UPDATE');
    expect(row.ref).toEqual({ schema: 'public', name: 'users_audit', kind: 'trigger', table: 'users' });
  });

  it('omits a missing timing without leaving a stray space', () => {
    const [row] = triggerRows([{ name: 't', schema: 'main', table: 'users', events: 'UPDATE' }]);
    expect(row.detail).toBe('UPDATE');
  });
});

describe('routineRows', () => {
  const routine = (over: Partial<RoutineInfo> = {}): RoutineInfo => ({
    name: 'add',
    schema: 'public',
    kind: 'function',
    ...over,
  });

  it('shows the signature and return type', () => {
    const [row] = routineRows([routine({ args: 'a integer, b integer', returnType: 'integer' })]);
    expect(row.label).toBe('add(a integer, b integer)');
    expect(row.detail).toBe('→ integer');
    expect(row.badge).toBe('function');
  });

  it('keys overloads apart by signature so both rows render', () => {
    const rows = routineRows([routine({ args: 'a integer' }), routine({ args: 'a text' })]);
    expect(rows.map((r) => r.key)).toEqual(['add(a integer)', 'add(a text)']);
    expect(rows[0].ref).toEqual({ schema: 'public', name: 'add', kind: 'function', args: 'a integer' });
  });

  it('renders an argument-less procedure', () => {
    const [row] = routineRows([routine({ name: 'cleanup', kind: 'procedure' })]);
    expect(row.label).toBe('cleanup()');
    expect(row.badge).toBe('procedure');
    expect(row.detail).toBe('');
  });
});

describe('cache keys', () => {
  it('separates groups of the same table', () => {
    expect(groupKey('c1', 'public', 'users', 'indexes')).toBe('c1:public:users:indexes');
    expect(groupKey('c1', 'public', 'users', 'triggers')).not.toBe(groupKey('c1', 'public', 'users', 'indexes'));
  });

  it('scopes routines to a schema', () => {
    expect(routinesKey('c1', 'public')).toBe('c1:public:routines');
  });
});
