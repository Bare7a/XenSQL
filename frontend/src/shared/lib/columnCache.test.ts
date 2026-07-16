import { describe, expect, it, vi } from 'vitest';
import { cachedColumns, invalidateColumnCache } from '@/shared/lib/columnCache';
import type { ColumnInfo } from '@/types';

const col = (name: string): ColumnInfo => ({
  name,
  dataType: 'text',
  isNullable: true,
  isPrimary: false,
  isForeign: false,
});

describe('columnCache', () => {
  it('fetches once and serves later requests from the cache', async () => {
    const fetch = vi.fn().mockResolvedValue([col('a')]);
    await cachedColumns('c1', 'public', 'users', fetch);
    await cachedColumns('c1', 'public', 'users', fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    let resolve: (v: ColumnInfo[]) => void = () => {};
    const fetch = vi.fn().mockImplementation(() => new Promise<ColumnInfo[]>((r) => (resolve = r)));
    const p1 = cachedColumns('c1', 'public', 'orders', fetch);
    const p2 = cachedColumns('c1', 'public', 'orders', fetch);
    resolve([col('id')]);
    expect(await p1).toEqual(await p2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches empty results until invalidated', async () => {
    const fetch = vi.fn().mockResolvedValue([]);
    await cachedColumns('c1', 'main', 'ghost', fetch);
    await cachedColumns('c1', 'main', 'ghost', fetch);
    expect(fetch).toHaveBeenCalledTimes(1);

    invalidateColumnCache('c1');
    await cachedColumns('c1', 'main', 'ghost', fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('evicts failed loads so the next request retries', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValue([col('id')]);
    await expect(cachedColumns('c1', 'public', 'flaky', fetch)).rejects.toThrow('busy');
    await expect(cachedColumns('c1', 'public', 'flaky', fetch)).resolves.toEqual([col('id')]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('invalidates per connection, not globally', async () => {
    const f1 = vi.fn().mockResolvedValue([col('a')]);
    const f2 = vi.fn().mockResolvedValue([col('b')]);
    await cachedColumns('conn-a', 'public', 't', f1);
    await cachedColumns('conn-b', 'public', 't', f2);

    invalidateColumnCache('conn-a');
    await cachedColumns('conn-a', 'public', 't', f1);
    await cachedColumns('conn-b', 'public', 't', f2);
    expect(f1).toHaveBeenCalledTimes(2);
    expect(f2).toHaveBeenCalledTimes(1);
  });
});
