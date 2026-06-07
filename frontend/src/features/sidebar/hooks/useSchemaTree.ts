import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/shared/lib/api';
import { formatError } from '@/shared/lib/normalize';
import { readStoredJson, writeStoredJson, STORAGE_KEYS } from '@/shared/lib/storageKeys';
import type { ColumnInfo, SchemaInfo } from '@/types';
import { useStoreActions, useTablesMap, useSchemas } from '@/store/selectors';

export const tableKey = (connectionId: string, schema: string, table: string) =>
  `${connectionId}:${schema}:${table}`;

export function columnMatchesSearch(col: ColumnInfo, needle: string): boolean {
  const hay = `${col.name} ${col.dataType}`.toLowerCase();
  return hay.includes(needle);
}

export function tableMatchesSearch(
  tableName: string,
  cols: ColumnInfo[] | undefined,
  needle: string
): boolean {
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

export function useSchemaTree({
  connId,
  connConnected,
  schemaList,
  schemaSearch,
}: SchemaTreeArgs) {
  const { t } = useTranslation();
  const tables = useTablesMap();
  const schemas = useSchemas();
  const { setConnected, setSchemas, setSelectedConnection, setTables } = useStoreActions();

  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>(() =>
    readStoredJson(STORAGE_KEYS.schemaExpanded, {})
  );
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>(() =>
    readStoredJson(STORAGE_KEYS.schemaTablesExpanded, {})
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
  useEffect(
    () => writeStoredJson(STORAGE_KEYS.schemaTablesExpanded, expandedTables),
    [expandedTables]
  );

  const loadSchema = useCallback(
    async (connId: string) => {
      if (!connId) {
        setSchemaError(t('errors.noConnection'));
        return;
      }
      setLoadingSchema(true);
      setSchemaError('');
      // Full (re)load: forget prior fetch markers so expanded nodes re-hydrate fresh.
      loadedTablesRef.current.clear();
      loadedColumnsRef.current.clear();
      setTableColumns({});

      try {
        const bundle = await api.loadSchemaData(connId);
        setConnected(connId, true);
        setSchemas(connId, bundle.schemas);
        setSelectedConnection(connId);

        for (const block of bundle.loadedTables ?? []) {
          if (!block?.schema) continue;
          const key = `${connId}:${block.schema}`;
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
    [setConnected, setSchemas, setSelectedConnection, setTables, t]
  );

  const loadTables = useCallback(
    async (connId: string, schema: string) => {
      const key = `${connId}:${schema}`;
      if (tables[key]?.length) {
        loadedTablesRef.current.add(key);
        setExpandedSchemas((e) => ({ ...e, [key]: true }));
        return;
      }
      setLoadingTables((prev) => ({ ...prev, [key]: true }));
      setSchemaError('');
      try {
        await api.connect(connId);
        setConnected(connId, true);
        const loaded = await api.listTables(connId, schema);
        setTables(key, loaded);
        loadedTablesRef.current.add(key);
        setExpandedSchemas((e) => ({ ...e, [key]: true }));
      } catch (err) {
        setSchemaError(formatError(err));
      } finally {
        setLoadingTables((prev) => ({ ...prev, [key]: false }));
      }
    },
    [tables, setConnected, setTables]
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
    [tableColumns, loadingColumns, setConnected]
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
    [expandedTables, fetchTableColumns]
  );

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

  // Pre-warm tables for all schemas while user types so name matches surface.
  useEffect(() => {
    if (!schemaSearch || !connId) return;
    for (const sch of schemaList) {
      const key = `${connId}:${sch.name}`;
      if (!loadedTablesRef.current.has(key) && !loadingTables[key]) {
        void loadTables(connId, sch.name);
      }
    }
  }, [schemaSearch, connId, schemaList, tables, loadingTables, loadTables]);

  // Pre-warm columns for non-matching table names so column matches surface.
  useEffect(() => {
    if (!schemaSearch || !connId) return;
    for (const sch of schemaList) {
      const key = `${connId}:${sch.name}`;
      for (const table of tables[key] || []) {
        const schemaName = table.schema || sch.name;
        if (table.name.toLowerCase().includes(schemaSearch)) continue;
        const tk = tableKey(connId, schemaName, table.name);
        if (loadedColumnsRef.current.has(tk) || loadingColumns[tk]) continue;
        void fetchTableColumns(connId, schemaName, table.name);
      }
    }
  }, [schemaSearch, connId, schemaList, tables, tableColumns, loadingColumns, fetchTableColumns]);

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
