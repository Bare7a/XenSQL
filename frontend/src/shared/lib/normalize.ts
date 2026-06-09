import { t } from '@/i18n';
import type {
  ColumnInfo,
  ConnectionStatus,
  HistoryEntry,
  QueryResult,
  SavedQuery,
  SchemaBundle,
  SchemaInfo,
  TableInfo,
} from '@/types';

export function toArray<T>(data: unknown): T[] {
  if (data == null) return [];
  return Array.isArray(data) ? data : [];
}

export function normalizeSchemas(data: unknown): SchemaInfo[] {
  return toArray<{ name?: string }>(data)
    .map((s) => ({ name: String(s?.name ?? '') }))
    .filter((s) => s.name.length > 0);
}

export function normalizeTables(data: unknown): TableInfo[] {
  return toArray<{ schema?: string; name?: string; type?: string }>(data).map((t) => ({
    schema: String(t?.schema ?? ''),
    name: String(t?.name ?? ''),
    type: String(t?.type ?? 'table'),
  }));
}

export function normalizeColumns(data: unknown): ColumnInfo[] {
  return toArray<{
    name?: string;
    dataType?: string;
    isNullable?: boolean;
    isPrimary?: boolean;
    isForeign?: boolean;
    defaultVal?: string;
  }>(data).map((c) => ({
    name: String(c?.name ?? ''),
    dataType: String(c?.dataType ?? ''),
    isNullable: Boolean(c?.isNullable),
    isPrimary: Boolean(c?.isPrimary),
    isForeign: Boolean(c?.isForeign),
    defaultVal: c?.defaultVal,
  }));
}

// SQL can repeat column names (SELECT a.id, b.id); the grid/JSON viewer/export key by name, so
// disambiguate duplicates (id, id_2, …). Cell data is positional, so only the name array changes.
export function uniquifyColumns(columns: string[]): string[] {
  const seen = new Set<string>();
  return columns.map((c) => {
    if (!seen.has(c)) {
      seen.add(c);
      return c;
    }
    let n = 2;
    let next = `${c}_${n}`;
    while (seen.has(next)) {
      n += 1;
      next = `${c}_${n}`;
    }
    seen.add(next);
    return next;
  });
}

/** Wails/JSON omits slice fields on non-SELECT results. */
export function normalizeQueryResult(result: QueryResult | null | undefined): QueryResult | null {
  if (result == null) return null;
  return {
    ...result,
    columns: uniquifyColumns(result.columns ?? []),
    columnTypes: result.columnTypes ?? [],
    rows: result.rows ?? [],
    primaryKeys: result.primaryKeys ?? [],
  };
}

export function normalizeConnectionStatus(data: unknown): ConnectionStatus {
  const s = (data ?? {}) as Record<string, unknown>;
  return {
    connected: Boolean(s.connected),
    database: String(s.database ?? ''),
    schema: String(s.schema ?? ''),
    user: String(s.user ?? ''),
    host: s.host != null ? String(s.host) : undefined,
  };
}

export function normalizeSchemaBundle(data: unknown): SchemaBundle {
  const b = (data ?? {}) as Record<string, unknown>;
  const loadedTables = toArray<{ schema?: string; tables?: unknown }>(b.loadedTables).map((block) => ({
    schema: String(block?.schema ?? ''),
    tables: normalizeTables(block?.tables),
  }));
  return {
    status: normalizeConnectionStatus(b.status),
    schemas: normalizeSchemas(b.schemas),
    loadedTables,
  };
}

export function normalizeHistory(data: unknown): HistoryEntry[] {
  return toArray<{
    id?: string;
    connectionId?: string;
    sql?: string;
    executedAt?: string;
    durationMs?: number;
    success?: boolean;
    error?: string;
  }>(data).map((h) => ({
    id: String(h?.id ?? ''),
    connectionId: String(h?.connectionId ?? ''),
    sql: String(h?.sql ?? ''),
    executedAt: String(h?.executedAt ?? ''),
    durationMs: Number(h?.durationMs ?? 0),
    success: Boolean(h?.success),
    error: h?.error,
  }));
}

export function normalizeSavedQueries(data: unknown): SavedQuery[] {
  return toArray<{
    id?: string;
    name?: string;
    connectionId?: string;
    sql?: string;
    createdAt?: string;
    updatedAt?: string;
  }>(data).map((q) => ({
    id: String(q?.id ?? ''),
    name: String(q?.name ?? ''),
    connectionId: q?.connectionId ? String(q.connectionId) : undefined,
    sql: String(q?.sql ?? ''),
    createdAt: String(q?.createdAt ?? ''),
    updatedAt: String(q?.updatedAt ?? ''),
  }));
}

export function formatError(err: unknown): string {
  if (err == null) return t('errors.unknown');
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}
