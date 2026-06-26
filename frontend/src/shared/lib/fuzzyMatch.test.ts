import { describe, expect, it } from 'vitest';
import { fuzzyMatch, rankCandidate } from '@/shared/lib/fuzzyMatch';

const score = (q: string, t: string) => fuzzyMatch(q, t)?.score ?? null;

describe('fuzzyMatch', () => {
  it('ranks exact > prefix > substring > subsequence', () => {
    const exact = score('users', 'users');
    const prefix = score('user', 'users');
    const substring = score('ser', 'users');
    const subsequence = score('urs', 'users');
    expect(exact).not.toBeNull();
    expect(exact!).toBeGreaterThan(prefix!);
    expect(prefix!).toBeGreaterThan(substring!);
    expect(substring!).toBeGreaterThan(subsequence!);
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'users')).toBeNull();
    expect(fuzzyMatch('sru', 'users')).toBeNull();
  });

  it('matches an empty query with score 0 and no ranges', () => {
    expect(fuzzyMatch('', 'users')).toEqual({ score: 0, ranges: [] });
  });

  it('is case-insensitive', () => {
    expect(score('USERS', 'users')).toBe(score('users', 'users'));
    expect(score('usr', 'USERS')).toBe(score('usr', 'users'));
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
    expect(score('acc', 'user_accounts')!).toBeGreaterThan(score('cco', 'user_accounts')!);
  });

  it('treats camelCase humps as boundaries', () => {
    expect(score('nam', 'userName')!).toBeGreaterThan(score('ame', 'userName')!);
  });

  it('prefers the shorter of two prefix matches', () => {
    expect(score('user', 'users')!).toBeGreaterThan(score('user', 'users_archive_table')!);
  });
});

describe('rankCandidate', () => {
  it('returns the primary label match when it matches', () => {
    const r = rankCandidate('foo', 'foobar', ['unrelated']);
    expect(r).not.toBeNull();
    expect(r!.ranges).toEqual([[0, 3]]);
  });

  it('falls back to a secondary field but caps it below a direct substring match', () => {
    const viaSecondary = rankCandidate('sales', 'orders', ['sales_db']);
    expect(viaSecondary).not.toBeNull();
    expect(viaSecondary!.ranges).toEqual([]);

    const viaPrimary = rankCandidate('sales', 'monthly_sales', ['nope']);
    expect(viaPrimary!.score).toBeGreaterThan(viaSecondary!.score);
  });

  it('returns null when neither primary nor secondary match', () => {
    expect(rankCandidate('zzz', 'abc', ['def'])).toBeNull();
  });

  it('matches everything on an empty query', () => {
    expect(rankCandidate('', 'anything', ['x'])).toEqual({ score: 0, ranges: [] });
  });
});
