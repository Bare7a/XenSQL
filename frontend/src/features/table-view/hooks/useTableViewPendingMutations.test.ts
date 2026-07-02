import { describe, expect, it } from 'vitest';
import { reconcileCellEdit } from '@/features/table-view/hooks/useTableViewPendingMutations';

describe('reconcileCellEdit', () => {
  it('records a new edit', () => {
    const draft = {};
    expect(reconcileCellEdit(draft, 'pk1', 'name', 'alice', 'bob')).toBe('changed');
    expect(draft).toEqual({ pk1: { name: 'bob' } });
  });

  it('is a no-op when the value is already at the original and nothing was recorded', () => {
    const draft = {};
    expect(reconcileCellEdit(draft, 'pk1', 'name', 'alice', 'alice')).toBe('unchanged');
    expect(draft).toEqual({});
  });

  it('clears the recorded edit when the value reverts to the original', () => {
    const draft = { pk1: { name: 'bob' } };
    expect(reconcileCellEdit(draft, 'pk1', 'name', 'alice', 'alice')).toBe('changed');
    expect(draft).toEqual({});
  });

  it('keeps other recorded columns when one reverts', () => {
    const draft = { pk1: { name: 'bob', age: '30' } };
    expect(reconcileCellEdit(draft, 'pk1', 'name', 'alice', 'alice')).toBe('changed');
    expect(draft).toEqual({ pk1: { age: '30' } });
  });

  it('is a no-op when the identical edit is already recorded', () => {
    const draft = { pk1: { name: 'bob' } };
    expect(reconcileCellEdit(draft, 'pk1', 'name', 'alice', 'bob')).toBe('unchanged');
    expect(draft).toEqual({ pk1: { name: 'bob' } });
  });

  it('compares against the original with string coercion (numeric cells)', () => {
    const draft = {};
    expect(reconcileCellEdit(draft, 'pk1', 'age', 30, '30')).toBe('unchanged');
    expect(reconcileCellEdit(draft, 'pk1', 'age', 30, '31')).toBe('changed');
    expect(draft).toEqual({ pk1: { age: '31' } });
  });

  it('treats null original and null value as no change', () => {
    const draft = {};
    expect(reconcileCellEdit(draft, 'pk1', 'note', null, null)).toBe('unchanged');
    expect(draft).toEqual({});
  });

  it('records setting a non-null original to NULL', () => {
    const draft = {};
    expect(reconcileCellEdit(draft, 'pk1', 'note', 'text', null)).toBe('changed');
    expect(draft).toEqual({ pk1: { note: null } });
  });

  it('reverts a recorded NULL back to the original', () => {
    const draft = { pk1: { note: null } };
    expect(reconcileCellEdit(draft, 'pk1', 'note', 'text', 'text')).toBe('changed');
    expect(draft).toEqual({});
  });
});
