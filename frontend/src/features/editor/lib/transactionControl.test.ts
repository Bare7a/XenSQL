import { describe, expect, it } from 'vitest';
import { detectTransactionControl } from '@/features/editor/lib/transactionControl';

describe('detectTransactionControl', () => {
  it('detects the bare keywords', () => {
    expect(detectTransactionControl('BEGIN')).toBe('begin');
    expect(detectTransactionControl('COMMIT')).toBe('commit');
    expect(detectTransactionControl('ROLLBACK')).toBe('rollback');
  });

  it('is case-insensitive and tolerates a trailing semicolon and whitespace', () => {
    expect(detectTransactionControl('  begin ;  ')).toBe('begin');
    expect(detectTransactionControl('Commit;')).toBe('commit');
    expect(detectTransactionControl('\nROLLBACK;\n')).toBe('rollback');
  });

  it('accepts the WORK / TRANSACTION variants', () => {
    expect(detectTransactionControl('BEGIN WORK')).toBe('begin');
    expect(detectTransactionControl('BEGIN TRANSACTION;')).toBe('begin');
    expect(detectTransactionControl('START TRANSACTION')).toBe('begin');
    expect(detectTransactionControl('COMMIT WORK')).toBe('commit');
    expect(detectTransactionControl('ROLLBACK TRANSACTION')).toBe('rollback');
  });

  it('ignores comments around the keyword', () => {
    expect(detectTransactionControl('/* go */ COMMIT; -- done')).toBe('commit');
    expect(detectTransactionControl('-- start\nBEGIN;')).toBe('begin');
  });

  it('returns null for ordinary statements', () => {
    expect(detectTransactionControl('SELECT 1')).toBeNull();
    expect(detectTransactionControl("SELECT 'COMMIT'")).toBeNull();
    expect(detectTransactionControl('')).toBeNull();
  });

  it('does not treat a partial rollback as ending the transaction', () => {
    expect(detectTransactionControl('ROLLBACK TO SAVEPOINT sp1')).toBeNull();
    expect(detectTransactionControl('SAVEPOINT sp1')).toBeNull();
  });

  it('returns null when the keyword is bundled with other statements', () => {
    expect(detectTransactionControl('BEGIN; SELECT 1; COMMIT;')).toBeNull();
    expect(detectTransactionControl('BEGIN; UPDATE t SET x = 1')).toBeNull();
  });
});
