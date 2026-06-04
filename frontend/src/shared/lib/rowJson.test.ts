import { describe, expect, it } from 'vitest';
import { filterJsonForViewer, rowToJsonObject } from '@/shared/lib/rowJson';

describe('rowToJsonObject', () => {
  const columns = ['id', 'name', 'note'];
  it('returns the visible subset in displayColumns order', () => {
    expect(
      rowToJsonObject(columns, ['note', 'id'], [1, 'alice', 'hi'])
    ).toEqual({ note: 'hi', id: 1 });
  });
  it('coerces undefined to null', () => {
    expect(
      rowToJsonObject(columns, ['name'], [1, undefined as unknown, ''])
    ).toEqual({ name: null });
  });
  it('skips display columns missing from the source columns', () => {
    expect(
      rowToJsonObject(columns, ['missing', 'id'], [1, 'a', 'b'])
    ).toEqual({ id: 1 });
  });
  it('parses JSON-looking strings into objects', () => {
    expect(
      rowToJsonObject(['payload'], ['payload'], ['{"a":1,"b":[2,3]}'])
    ).toEqual({ payload: { a: 1, b: [2, 3] } });
  });
  it('keeps malformed JSON strings as-is', () => {
    expect(
      rowToJsonObject(['payload'], ['payload'], ['{not valid json}'])
    ).toEqual({ payload: '{not valid json}' });
  });
  it('uses the optional Map lookup when provided (no indexOf)', () => {
    const lookup = new Map([
      ['id', 0],
      ['name', 1],
      ['note', 2],
    ]);
    expect(
      rowToJsonObject(columns, ['note', 'id'], [1, 'alice', 'hi'], lookup)
    ).toEqual({ note: 'hi', id: 1 });
  });
  it('skips columns missing from the Map lookup', () => {
    const lookup = new Map([
      ['id', 0],
      ['name', 1],
    ]);
    expect(
      rowToJsonObject(columns, ['note', 'id'], [1, 'alice', 'hi'], lookup)
    ).toEqual({ id: 1 });
  });
});

describe('filterJsonForViewer', () => {
  it('returns the original value when query is empty', () => {
    const v = { a: 1, b: 'x' };
    expect(filterJsonForViewer(v, '   ')).toBe(v);
  });
  it('keeps entries where the key matches', () => {
    expect(filterJsonForViewer({ name: 'x', other: 'y' }, 'name')).toEqual({ name: 'x' });
  });
  it('keeps entries where the value matches', () => {
    expect(filterJsonForViewer({ name: 'alice', age: 30 }, 'lic')).toEqual({ name: 'alice' });
  });
  it('descends into nested objects', () => {
    expect(
      filterJsonForViewer({ outer: { inner: 'hit', other: 'no' }, sibling: 'no' }, 'hit')
    ).toEqual({ outer: { inner: 'hit' } });
  });
  it('returns undefined when nothing matches', () => {
    expect(filterJsonForViewer({ a: 1 }, 'zzz')).toBeUndefined();
  });
  it('supports /regex/ syntax', () => {
    expect(filterJsonForViewer({ name: 'ALICE' }, '/alice/')).toEqual({ name: 'ALICE' });
  });
  it('falls back to substring match on invalid regex', () => {
    // /[/ is invalid regex; falls back to substring match - key '/[/' hits, value 'x' does not
    expect(filterJsonForViewer({ '/[/': 'x', other: 'y' }, '/[/')).toEqual({ '/[/': 'x' });
  });
});
