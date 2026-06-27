import { describe, expect, it } from 'vitest';
import { type FuzzyResult, fuzzyMatch, rankCandidate } from '@/shared/lib/fuzzyMatch';

function requireScore(q: string, t: string): number {
  const result = fuzzyMatch(q, t);
  expect(result).not.toBeNull();
  if (result === null) throw new Error(`expected match for "${q}" in "${t}"`);
  return result.score;
}

function requireRank(query: string, primary: string, secondary: string[] = []): FuzzyResult {
  const result = rankCandidate(query, primary, secondary);
  expect(result).not.toBeNull();
  if (result === null) throw new Error(`expected rank for "${query}" in "${primary}"`);
  return result;
}

describe('fuzzyMatch', () => {
  it('ranks exact > prefix > substring > subsequence', () => {
    const exact = requireScore('users', 'users');
    const prefix = requireScore('user', 'users');
    const substring = requireScore('ser', 'users');
    const subsequence = requireScore('urs', 'users');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'users')).toBeNull();
    expect(fuzzyMatch('sru', 'users')).toBeNull();
  });

  it('matches an empty query with score 0 and no ranges', () => {
    expect(fuzzyMatch('', 'users')).toEqual({ score: 0, ranges: [] });
  });

  it('is case-insensitive', () => {
    expect(requireScore('USERS', 'users')).toBe(requireScore('users', 'users'));
    expect(requireScore('usr', 'USERS')).toBe(requireScore('usr', 'users'));
  });

  it('returns highlight ranges into the original text', () => {
    expect(fuzzyMatch('users', 'users')?.ranges).toEqual([[0, 5]]);
    expect(fuzzyMatch('user', 'users')?.ranges).toEqual([[0, 4]]);
    expect(fuzzyMatch('ser', 'users')?.ranges).toEqual([[1, 4]]);
    expect(fuzzyMatch('urs', 'users')?.ranges).toEqual([
      [0, 1],
      [3, 5],
    ]);
  });

  it('rewards matches that start on a word boundary', () => {
    expect(requireScore('acc', 'user_accounts')).toBeGreaterThan(requireScore('cco', 'user_accounts'));
  });

  it('treats camelCase humps as boundaries', () => {
    expect(requireScore('nam', 'userName')).toBeGreaterThan(requireScore('ame', 'userName'));
  });

  it('prefers the shorter of two prefix matches', () => {
    expect(requireScore('user', 'users')).toBeGreaterThan(requireScore('user', 'users_archive_table'));
  });
});

describe('rankCandidate', () => {
  it('returns the primary label match when it matches', () => {
    const r = requireRank('foo', 'foobar', ['unrelated']);
    expect(r.ranges).toEqual([[0, 3]]);
  });

  it('falls back to a secondary field but caps it below a direct substring match', () => {
    const viaSecondary = requireRank('sales', 'orders', ['sales_db']);
    expect(viaSecondary.ranges).toEqual([]);

    const viaPrimary = requireRank('sales', 'monthly_sales', ['nope']);
    expect(viaPrimary.score).toBeGreaterThan(viaSecondary.score);
  });

  it('returns null when neither primary nor secondary match', () => {
    expect(rankCandidate('zzz', 'abc', ['def'])).toBeNull();
  });

  it('matches everything on an empty query', () => {
    expect(rankCandidate('', 'anything', ['x'])).toEqual({ score: 0, ranges: [] });
  });
});
