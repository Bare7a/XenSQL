import { describe, expect, it } from 'vitest';
import { tokenizeSql } from '@/features/editor/lib/sqlTokens';
import type { DriverType } from '@/types';

describe('tokenizeSql basics', () => {
  it('tokenizes a representative statement', () => {
    const tokens = tokenizeSql("SELECT u.id, 'x' FROM users u -- t\nWHERE a >= 1", 'postgres');
    expect(tokens.map((t) => t.kind)).toEqual([
      'ident', // SELECT
      'ident', // u
      'punct', // .
      'ident', // id
      'punct', // ,
      'string', // 'x'
      'ident', // FROM
      'ident', // users
      'ident', // u
      'comment', // -- t
      'ident', // WHERE
      'ident', // a
      'op', // >=
      'number', // 1
    ]);
    expect(tokens[0].lower).toBe('select');
  });

  const lastToken = (sql: string) => {
    const tokens = tokenizeSql(sql);
    return tokens[tokens.length - 1];
  };

  it('marks unterminated strings, quoted idents and comments', () => {
    expect(lastToken("SELECT 'ab")).toMatchObject({ kind: 'string', unterminated: true });
    expect(lastToken('SELECT "ab')).toMatchObject({ kind: 'quoted', unterminated: true });
    expect(lastToken('SELECT 1 /* x')).toMatchObject({ kind: 'comment', unterminated: true });
    expect(lastToken('SELECT 1 -- x')).toMatchObject({ kind: 'comment', unterminated: true });
    expect(lastToken('SELECT 1 -- x\n').unterminated).toBeUndefined();
  });

  it('keeps dollar-quoted bodies tokenized (delimiters are ops)', () => {
    const tokens = tokenizeSql('DO $$ SELECT 1 $$', 'postgres');
    expect(tokens.map((t) => t.text)).toEqual(['DO', '$$', 'SELECT', '1', '$$']);
  });
});

describe('tokenizeSql fuzz invariants', () => {
  // Deterministic LCG so failures reproduce; the seed is printed via the assertion message.
  const lcg = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const PIECES = [
    "'",
    '"',
    '`',
    '$',
    '$$',
    '$tag$',
    '--',
    '#',
    '/*',
    '*/',
    '\\',
    ';',
    '\n',
    ' ',
    '.',
    ',',
    '(',
    ')',
    '=',
    '<=',
    '<>',
    '::',
    'SELECT',
    'from',
    'users',
    '"Us"',
    "'it''s'",
    'E',
    '1.5e3',
    '$1',
    'абв', // non-ASCII passes through as single-char ops without crashing
    '🙂',
  ];

  const drivers: (DriverType | undefined)[] = ['postgres', 'mysql', 'sqlite', undefined];

  it('never crashes and always produces well-formed spans', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = lcg(seed);
      const parts: string[] = [];
      const n = 1 + Math.floor(rnd() * 40);
      for (let i = 0; i < n; i++) parts.push(PIECES[Math.floor(rnd() * PIECES.length)]);
      const text = parts.join('');
      const driver = drivers[Math.floor(rnd() * drivers.length)];

      const tokens = tokenizeSql(text, driver);
      let prevEnd = 0;
      for (const t of tokens) {
        const ctx = `seed=${seed} driver=${driver} text=${JSON.stringify(text)}`;
        expect(t.start, ctx).toBeGreaterThanOrEqual(prevEnd);
        expect(t.end, ctx).toBeGreaterThan(t.start);
        expect(t.end, ctx).toBeLessThanOrEqual(text.length);
        expect(t.text, ctx).toBe(text.slice(t.start, t.end));
        prevEnd = t.end;
      }
    }
  });

  it('skipped gaps are only whitespace', () => {
    for (let seed = 200; seed <= 300; seed++) {
      const rnd = lcg(seed);
      const parts: string[] = [];
      const n = 1 + Math.floor(rnd() * 30);
      for (let i = 0; i < n; i++) parts.push(PIECES[Math.floor(rnd() * PIECES.length)]);
      const text = parts.join(' ');

      const tokens = tokenizeSql(text, 'postgres');
      let pos = 0;
      for (const t of tokens) {
        const gap = text.slice(pos, t.start);
        expect(gap.trim(), `seed=${seed} text=${JSON.stringify(text)}`).toBe('');
        pos = t.end;
      }
      expect(text.slice(pos).trim(), `seed=${seed}`).toBe('');
    }
  });
});
