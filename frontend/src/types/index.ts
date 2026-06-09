export type DriverType = 'sqlite' | 'postgres' | 'mysql';

export interface ConnectionConfig {
  id: string;
  name: string;
  driver: DriverType;
  color: string;
  folderId?: string;
  filePath?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sslMode?: string;
  schema?: string;
  readOnly?: boolean;
}

export interface ConnectionFolder {
  id: string;
  name: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  defaultVal?: string;
}

export interface TableInfo {
  schema: string;
  name: string;
  type: string;
}

export interface SchemaInfo {
  name: string;
}

export interface SchemaTables {
  schema: string;
  tables: TableInfo[];
}

export interface SchemaBundle {
  status: ConnectionStatus;
  schemas: SchemaInfo[];
  loadedTables: SchemaTables[];
}

export interface ConnectionStatus {
  connected: boolean;
  database: string;
  schema: string;
  user: string;
  host?: string;
}

export interface QueryResult {
  columns: string[];
  columnTypes: string[];
  rows: unknown[][];
  rowCount: number;
  affectedRows: number;
  durationMs: number;
  message?: string;
  primaryKeys?: string[];
  tableName?: string;
  schemaName?: string;
  /** Stable per query run; more rows change rowCount but not streamId. */
  streamId?: string;
  streaming?: boolean;
}

export interface QueryStreamMetaPayload {
  tabId: string;
  streamId: string;
  connectionId: string;
  resultIndex: number;
  columns: string[];
  columnTypes: string[];
  schemaName?: string;
  tableName?: string;
}

export interface QueryStreamRowsPayload {
  tabId: string;
  streamId: string;
  resultIndex: number;
  rows: unknown[][];
}

// Finalizes one result set within a run (result carries metadata only; rows arrived via rows events).
export interface QueryStreamResultPayload {
  tabId: string;
  streamId: string;
  connectionId: string;
  resultIndex: number;
  result?: QueryResult | null;
  statement?: string;
  error?: string;
}

// Terminates a run. resultCount is how many result sets were emitted; error is a batch-level
// failure (per-statement errors arrive on the result event instead).
export interface QueryStreamDonePayload {
  tabId: string;
  streamId: string;
  connectionId: string;
  resultCount: number;
  error?: string;
}

export interface EditorTab {
  id: string;
  connectionId: string;
  title: string;
  sql: string;
  color: string;
  savedQueryId?: string;
  savedSqlBaseline?: string /** detect unsaved edits */;
  editorCursor?: EditorCursorState;
  tableView?: {
    schema: string;
    table: string;
    filter?: string;
    orderBy?: string | null;
    orderDir?: 'ASC' | 'DESC';
  };
}

export interface EditorCursorState {
  lineNumber: number;
  column: number;
  scrollTop?: number;
}

export interface TableViewPendingState {
  edits: Record<string, Record<string, unknown>>;
  deletes: string[];
}

export interface TableViewSessionState {
  schema: string;
  table: string;
  filter: string;
  orderBy: string | null;
  orderDir: 'ASC' | 'DESC';
  rows: unknown[][];
  columns: string[];
  columnTypes: string[];
  primaryKeys: string[];
  hasMore: boolean;
  pending: TableViewPendingState;
}

export type TxnState = 'idle' | 'active' | 'error';

// One result set produced by a run: either a grid (result) or a failure (error). A run can produce
// several - multiple statements in a script, or a stored procedure returning more than one set.
export interface ResultSet {
  result: QueryResult | null;
  error: string | null;
  statement?: string;
}

export interface TabSessionState {
  // result and resultError mirror the active result set (results[activeResultIndex]) so existing
  // single-result readers keep working; results holds every set for the current run.
  result: QueryResult | null;
  resultError: string | null;
  results: ResultSet[];
  activeResultIndex: number;
  runStreamId?: string;
  focusedRow: Record<string, unknown> | null;
  dataBrowser: { schema: string; table: string } | null;
  tableViewState?: TableViewSessionState | null;
  txnState?: TxnState;
}

export const emptyTabSession = (): TabSessionState => ({
  result: null,
  resultError: null,
  results: [],
  activeResultIndex: 0,
  focusedRow: null,
  dataBrowser: null,
  tableViewState: null,
});

export const emptyTableViewPending = (): TableViewPendingState => ({
  edits: {},
  deletes: [],
});

export interface HistoryEntry {
  id: string;
  connectionId: string;
  sql: string;
  executedAt: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  connectionId?: string;
  sql: string;
  createdAt: string;
  updatedAt: string;
}

export interface TableDataRequest {
  schema: string;
  table: string;
  offset: number;
  limit: number;
  orderBy?: string;
  orderDir?: string;
  filter?: string;
}

export const DEFAULT_COLORS = [
  // base (Tailwind 500)
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
  '#64748b',
  // dark (Tailwind 700)
  '#b91c1c',
  '#c2410c',
  '#b45309',
  '#a16207',
  '#4d7c0f',
  '#15803d',
  '#0f766e',
  '#0e7490',
  '#0369a1',
  '#1d4ed8',
  '#4338ca',
  '#6d28d9',
  '#7e22ce',
  '#be185d',
  '#334155',
];

export const DEFAULT_CONNECTION_COLOR = '#3b82f6';
