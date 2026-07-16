import type { ColumnInfo } from '@/types';

// One fetch per connection+table, shared in-flight promise. Failed loads are evicted so transient
// errors retry; successes (empty included) stick until a schema refresh invalidates them.
const cache = new Map<string, Promise<ColumnInfo[]>>();

const keyOf = (connectionId: string, schema: string, table: string) => `${connectionId}:${schema}.${table}`;

export function cachedColumns(
  connectionId: string,
  schema: string,
  table: string,
  fetch: () => Promise<ColumnInfo[]>,
): Promise<ColumnInfo[]> {
  const key = keyOf(connectionId, schema, table);
  let entry = cache.get(key);
  if (!entry) {
    entry = fetch().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, entry);
  }
  return entry;
}

/** Drop a connection's cached tables (schema refresh). */
export function invalidateColumnCache(connectionId: string): void {
  const prefix = `${connectionId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
