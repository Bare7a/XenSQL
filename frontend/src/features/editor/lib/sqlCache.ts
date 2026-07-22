// LRU for shared per-keystroke analysis (tokenize / cursor / parse).
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

// One LRU per dialect, keyed by the SQL text itself. Keying on the existing string
// avoids concatenating a fresh `driver + buffer` key (and re-hashing it) on every access.
export class DriverLruCache<V> {
  private byDriver = new Map<string, LruCache<V>>();

  constructor(private readonly limit: number) {}

  of(driver: string | undefined): LruCache<V> {
    const key = driver ?? '';
    let cache = this.byDriver.get(key);
    if (!cache) {
      cache = new LruCache<V>(this.limit);
      this.byDriver.set(key, cache);
    }
    return cache;
  }
}
