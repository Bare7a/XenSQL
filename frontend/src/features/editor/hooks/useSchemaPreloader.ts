import { useCallback, useEffect } from 'react';
import { api } from '@/shared/lib/api';
import { cachedColumns } from '@/shared/lib/columnCache';
import { useAppStore } from '@/store/appStore';
import type { ColumnInfo, EditorTab } from '@/types';

// Preloads schema for each open tab's connection so autocomplete works before the schema browser is opened.
export function useSchemaPreloader(
  tabs: EditorTab[],
  connectionCount: number,
): {
  loadColumnsForConnection: (connectionId: string) => (schema: string, table: string) => Promise<ColumnInfo[]>;
} {
  const loadSchemaForConnection = useCallback(async (connId: string) => {
    if (!connId) return;
    const { tables, setConnected, setSchemas, setTables } = useAppStore.getState();
    // Skip if any table for this connection is already cached.
    if (Object.keys(tables).some((k) => k.startsWith(`${connId}:`))) return;

    try {
      const bundle = await api.loadSchemaData(connId);
      setConnected(connId, true);
      setSchemas(connId, bundle.schemas);
      for (const block of bundle.loadedTables ?? []) {
        if (!block?.schema) continue;
        setTables(`${connId}:${block.schema}`, block.tables ?? []);
      }
    } catch {
      /* schema is optional for autocomplete */
    }
  }, []);

  useEffect(() => {
    if (tabs.length === 0 || connectionCount === 0) return;
    const connIds = [...new Set(tabs.map((t) => t.connectionId).filter(Boolean))];
    for (const connId of connIds) {
      void loadSchemaForConnection(connId);
    }
  }, [tabs, connectionCount, loadSchemaForConnection]);

  const loadColumnsForConnection = useCallback(
    (connectionId: string) =>
      (schema: string, table: string): Promise<ColumnInfo[]> =>
        cachedColumns(connectionId, schema, table, () => api.listColumns(connectionId, schema, table)),
    [],
  );

  return { loadColumnsForConnection };
}
