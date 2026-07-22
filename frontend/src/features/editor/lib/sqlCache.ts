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

// Dialect + SQL text; '\0' cannot appear in either side.
export function cacheKey(driver: string | undefined, text: string): string {
  return `${driver ?? ''}\0${text}`;
}
