import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/shared/lib/api';
import { invalidateColumnCache } from '@/shared/lib/columnCache';
import { formatError } from '@/shared/lib/normalize';
import { readStoredJson, STORAGE_KEYS, writeStoredJson } from '@/shared/lib/storageKeys';
import { useSchemas, useStoreActions, useTablesMap } from '@/store/selectors';
import type { ColumnInfo, SchemaInfo } from '@/types';

export const tableKey = (connectionId: string, schema: string, table: string) => `${connectionId}:${schema}:${table}`;

export function columnMatchesSearch(col: ColumnInfo, needle: string): boolean {
  const hay = `${col.name} ${col.dataType}`.toLowerCase();
  return hay.includes(needle);
}

export function tableMatchesSearch(tableName: string, cols: ColumnInfo[] | undefined, needle: string): boolean {
  if (tableName.toLowerCase().includes(needle)) return true;
  if (!cols?.length) return false;
  return cols.some((col) => columnMatchesSearch(col, needle));
}

interface SchemaTreeArgs {
  connId: string | null;
  connConnected: boolean;
  schemaList: SchemaInfo[];
  schemaSearch: string;
}

export function useSchemaTree({ connId, connConnected, schemaList, schemaSearch }: SchemaTreeArgs) {
  const { t } = useTranslation();
  const tables = useTablesMap();
  const schemas = useSchemas();
  const { setConnected, setSchemas, setSelectedConnection, setTables } = useStoreActions();

  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>(() =>
    readStoredJson(STORAGE_KEYS.schemaExpanded, {}),
  );
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>(() =>
    readStoredJson(STORAGE_KEYS.schemaTablesExpanded, {}),
  );
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [loadingTables, setLoadingTables] = useState<Record<string, boolean>>({});
  const [schemaError, setSchemaError] = useState('');
  const [loadingColumns, setLoadingColumns] = useState<Record<string, boolean>>({});
  const [tableColumns, setTableColumns] = useState<Record<string, ColumnInfo[]>>({});

  // "Fetched" tracked apart from "has rows": an empty schema ([] tables) is loaded and must not be
  // re-fetched, else the effects below loop on every `tables` change.
  const loadedTablesRef = useRef<Set<string>>(new Set());
  const loadedColumnsRef = useRef<Set<string>>(new Set());

  // Persist tree expansion across tab switches / relaunch; empty restored nodes are hydrated below.
  useEffect(() => writeStoredJson(STORAGE_KEYS.schemaExpanded, expandedSchemas), [expandedSchemas]);
  useEffect(() => writeStoredJson(STORAGE_KEYS.schemaTablesExpanded, expandedTables), [expandedTables]);

  const loadSchema = useCallback(
    async (connectionId: string) => {
      if (!connectionId) {
        setSchemaError(t('errors.noConnection'));
        return;
      }
      setLoadingSchema(true);
      setSchemaError('');
      // Full (re)load: forget fetch markers and the editor's column cache.
      loadedTablesRef.current.clear();
      loadedColumnsRef.current.clear();
      setTableColumns({});
      invalidateColumnCache(connectionId);

      try {
        const bundle = await api.loadSchemaData(connectionId);
        setConnected(connectionId, true);
        setSchemas(connectionId, bundle.schemas);
        setSelectedConnection(connectionId);

        for (const block of bundle.loadedTables ?? []) {
          if (!block?.schema) continue;
          const key = `${connectionId}:${block.schema}`;
          setTables(key, block.tables ?? []);
          loadedTablesRef.current.add(key);
          setExpandedSchemas((e) => ({ ...e, [key]: true }));
        }
      } catch (err) {
        setSchemaError(formatError(err));
      } finally {
        setLoadingSchema(false);
      }
    },
    [setConnected, setSchemas, setSelectedConnection, setTables, t],
  );

  const loadTables = useCallback(
    async (connectionId: string, schema: string) => {
      const key = `${connectionId}:${schema}`;
      if (tables[key]?.length) {
        loadedTablesRef.current.add(key);
        setExpandedSchemas((e) => ({ ...e, [key]: true }));
        return;
      }
      setLoadingTables((prev) => ({ ...prev, [key]: true }));
      setSchemaError('');
      try {
        await api.connect(connectionId);
        setConnected(connectionId, true);
        const loaded = await api.listTables(connectionId, schema);
        setTables(key, loaded);
        loadedTablesRef.current.add(key);
        setExpandedSchemas((e) => ({ ...e, [key]: true }));
      } catch (err) {
        setSchemaError(formatError(err));
      } finally {
        setLoadingTables((prev) => ({ ...prev, [key]: false }));
      }
    },
    [tables, setConnected, setTables],
  );

  // Short-circuit dedupes both "already loaded" and "in-flight" - search effect calls this in a tight loop.
  const fetchTableColumns = useCallback(
    async (connectionId: string, schema: string, table: string) => {
      const key = tableKey(connectionId, schema, table);
      if (tableColumns[key]?.length) {
        loadedColumnsRef.current.add(key);
        return;
      }
      if (loadingColumns[key]) return;

      setLoadingColumns((prev) => ({ ...prev, [key]: true }));
      setSchemaError('');
      try {
        await api.connect(connectionId);
        setConnected(connectionId, true);
        const cols = await api.listColumns(connectionId, schema, table);
        setTableColumns((prev) => ({ ...prev, [key]: cols }));
        loadedColumnsRef.current.add(key);
      } catch (err) {
        setSchemaError(formatError(err));
      } finally {
        setLoadingColumns((prev) => ({ ...prev, [key]: false }));
      }
    },
    [tableColumns, loadingColumns, setConnected],
  );

  const toggleTableColumns = useCallback(
    async (connectionId: string, schema: string, table: string) => {
      const key = tableKey(connectionId, schema, table);
      if (expandedTables[key]) {
        setExpandedTables((prev) => ({ ...prev, [key]: false }));
        return;
      }
      setExpandedTables((prev) => ({ ...prev, [key]: true }));
      await fetchTableColumns(connectionId, schema, table);
    },
    [expandedTables, fetchTableColumns],
  );

  // Drop a stale error on connection switch (sync, so it can't wipe loadSchema's later async error).
  useEffect(() => {
    setSchemaError('');
  }, [connId]);

  // Load schema once per connection, then reuse the store cache so tab switches don't re-fetch.
  // The refresh button calls loadSchema directly to force a reload. (ConnectionSwitcher owns the connect step.)
  useEffect(() => {
    if (connId && connConnected && !schemas[connId]) void loadSchema(connId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, connConnected]);

  // Hydrate expanded nodes restored from persisted settings that still have no data.
  useEffect(() => {
    if (!connId || !connConnected) return;
    for (const sch of schemaList) {
      const key = `${connId}:${sch.name}`;
      if (expandedSchemas[key] && !loadedTablesRef.current.has(key) && !loadingTables[key]) {
        void loadTables(connId, sch.name);
      }
      for (const tbl of tables[key] || []) {
        const schemaName = tbl.schema || sch.name;
        const tk = tableKey(connId, schemaName, tbl.name);
        if (expandedTables[tk] && !loadedColumnsRef.current.has(tk) && !loadingColumns[tk]) {
          void fetchTableColumns(connId, schemaName, tbl.name);
        }
      }
    }
  }, [
    connId,
    connConnected,
    schemaList,
    tables,
    expandedSchemas,
    expandedTables,
    loadingTables,
    loadingColumns,
    tableColumns,
    loadTables,
    fetchTableColumns,
  ]);

  // Pre-warm while the user types: tables for every schema (so name matches surface) and columns
  // for non-matching table names (so column matches surface). Loaded/loading guards make re-runs no-ops.
  useEffect(() => {
    if (!schemaSearch || !connId) return;
    for (const sch of schemaList) {
      const key = `${connId}:${sch.name}`;
      if (!loadedTablesRef.current.has(key) && !loadingTables[key]) {
        void loadTables(connId, sch.name);
      }
      for (const table of tables[key] || []) {
        const schemaName = table.schema || sch.name;
        if (table.name.toLowerCase().includes(schemaSearch)) continue;
        const tk = tableKey(connId, schemaName, table.name);
        if (loadedColumnsRef.current.has(tk) || loadingColumns[tk]) continue;
        void fetchTableColumns(connId, schemaName, table.name);
      }
    }
  }, [
    schemaSearch,
    connId,
    schemaList,
    tables,
    tableColumns,
    loadingTables,
    loadingColumns,
    loadTables,
    fetchTableColumns,
  ]);

  return {
    tables,
    expandedSchemas,
    setExpandedSchemas,
    expandedTables,
    loadingSchema,
    loadingTables,
    loadingColumns,
    tableColumns,
    schemaError,
    setSchemaError,
    loadSchema,
    loadTables,
    toggleTableColumns,
  };
}
