// Tiny LRU used to memoize the pure per-keystroke analysis entry points (tokenize, cursor
// analysis, query/statement parsing). One keystroke fans out to several Monaco providers that
// re-analyze identical strings; the cache collapses those to a single computation.
// Pattern borrowed from potygen's inspect cache (packages/potygen/src/inspect/cache.ts).
export class LruCache<V> {
  private map = new Map<string, V>();

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): V {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    return value;
  }
}

// Cache keys join the dialect and source text; '\0' cannot appear in either side of the key.
export function cacheKey(driver: string | undefined, text: string): string {
  return `${driver ?? ''}\0${text}`;
}
