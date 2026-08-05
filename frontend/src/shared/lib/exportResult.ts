import { settings } from '@/shared/lib/settingsStore';
import { STORAGE_KEYS } from '@/shared/lib/storageKeys';
import type { QueryResult } from '@/types';

export type ExportFormat = 'csv' | 'json' | 'markdown' | 'sql' | 'text';

export interface ExportOptions {
  columns: string[];
  rowIndices: number[];
}

const EXPORT_CHUNK_ROWS = 5000;

// Reads rows in place, so an export never duplicates the result in memory.
interface ExportView {
  columns: string[];
  columnTypes: string[];
  rowIndices: Iterable<number>;
  cells: (rowIndex: number) => unknown[];
}

function* range(count: number): Generator<number> {
  for (let i = 0; i < count; i++) yield i;
}

// Positional, so duplicate column names (SELECT 1 AS a, 2 AS a) keep their own values.
function allColumnsView(result: QueryResult): ExportView {
  return {
    columns: result.columns,
    columnTypes: result.columns.map((_, i) => result.columnTypes?.[i] ?? ''),
    rowIndices: range(result.rows.length),
    cells: (ri) => result.rows[ri],
  };
}

function subsetView(result: QueryResult, opts: ExportOptions): ExportView {
  const colIndices = opts.columns.map((c) => result.columns.indexOf(c)).filter((i) => i >= 0);
  return {
    columns: colIndices.map((i) => result.columns[i]),
    columnTypes: colIndices.map((i) => result.columnTypes?.[i] ?? ''),
    rowIndices: opts.rowIndices,
    cells: (ri) => {
      const row = result.rows[ri];
      if (!row) return colIndices.map(() => null); // guard against a stale out-of-range selection index
      return colIndices.map((i) => row[i]);
    },
  };
}

// Defuse spreadsheet formula injection (cells starting = + - @), but leave plain numbers (-5) alone.
function defuseCsvFormula(s: string): string {
  if (!/^[=+\-@]/.test(s)) return s;
  if (Number.isFinite(Number(s))) return s;
  return `'${s}`;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function sqlLiteral(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

interface RowFormatter {
  header: string;
  open: string;
  sep: string;
  close: string;
  empty: string;
  row: (cells: unknown[]) => string;
}

// bigint isn't JSON-serializable; emit it as a number (backend already sends out-of-range ints as strings).
function jsonBigint(_key: string, val: unknown): unknown {
  return typeof val === 'bigint' ? Number(val) : val;
}

function jsonFormatter(view: ExportView): RowFormatter {
  // Nest JSON/JSONB columns instead of string-wrapping them (matches the row JSON viewer).
  const isJsonCol = view.columnTypes.map((t) => /json/i.test(t));
  return {
    header: '',
    open: '[\n',
    sep: ',\n',
    close: '\n]',
    empty: '[]',
    row: (cells) => {
      const m: Record<string, unknown> = {};
      view.columns.forEach((col, i) => {
        const v = cells[i];
        m[col] = isJsonCol[i] && typeof v === 'string' ? safeJsonParse(v) : v;
      });
      // One level deeper, so it reads as an element of the array JSON.stringify(allRows, …, 2) builds.
      return `  ${JSON.stringify(m, jsonBigint, 2).replace(/\n/g, '\n  ')}`;
    },
  };
}

function csvFormatter(view: ExportView): RowFormatter {
  const escapeCsv = (cell: string) => {
    // Mirror Go's encoding/csv: quote on delimiter/quote/newline, leading whitespace, or \. sentinel.
    const needsQuote = cell === '\\.' || /[",\n\r]/.test(cell) || /^\s/u.test(cell);
    if (needsQuote) return `"${cell.replace(/"/g, '""')}"`;
    return cell;
  };
  return {
    header: view.columns.map(escapeCsv).join(','),
    open: '\n',
    sep: '\n',
    close: '',
    empty: '',
    row: (cells) => cells.map((v) => (v == null ? '' : escapeCsv(defuseCsvFormula(String(v))))).join(','),
  };
}

function markdownFormatter(view: ExportView): RowFormatter {
  // Escape headers too, not just cells - a column named `a|b` would break the alignment.
  const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r\n?|\n/g, ' ');
  const sep = view.columns.map(() => '---');
  return {
    header: `| ${view.columns.map(mdCell).join(' | ')} |\n| ${sep.join(' | ')} |`,
    open: '\n',
    sep: '\n',
    close: '',
    empty: '',
    row: (cells) => `| ${cells.map((v) => (v == null ? '' : mdCell(String(v)))).join(' | ')} |`,
  };
}

function sqlFormatter(view: ExportView, tableName: string | undefined): RowFormatter {
  const quoteIdent = (id: string) => `"${id.replace(/"/g, '""')}"`;
  const table = quoteIdent(tableName || 'results');
  const quotedCols = view.columns.map(quoteIdent).join(', ');
  return {
    header: '',
    open: '',
    sep: '\n',
    close: '',
    empty: '',
    row: (cells) => `INSERT INTO ${table} (${quotedCols}) VALUES (${cells.map(sqlLiteral).join(', ')});`,
  };
}

const TEXT_FORMATTER: RowFormatter = {
  header: '',
  open: '',
  sep: '\n',
  close: '',
  empty: '',
  row: (cells) => cells.map((v) => (v == null ? '' : String(v))).join('\t'),
};

function rowFormatter(view: ExportView, format: ExportFormat, tableName: string | undefined): RowFormatter | null {
  switch (format) {
    case 'json':
      return jsonFormatter(view);
    case 'csv':
      return csvFormatter(view);
    case 'markdown':
      return markdownFormatter(view);
    case 'sql':
      return sqlFormatter(view, tableName);
    case 'text':
      return TEXT_FORMATTER;
    default:
      return null;
  }
}

export interface ExportChunk {
  text: string;
  /** Rows in this chunk, not cumulative. */
  rows: number;
}

function* formatView(
  view: ExportView,
  format: ExportFormat,
  tableName: string | undefined,
  rowsPerChunk: number,
): Generator<ExportChunk> {
  const fmt = rowFormatter(view, format, tableName);
  if (!fmt) return;

  let pending = fmt.header;
  let pendingRows = 0;
  let written = 0;
  for (const rowIndex of view.rowIndices) {
    pending += written === 0 ? fmt.open : fmt.sep;
    pending += fmt.row(view.cells(rowIndex));
    written++;
    pendingRows++;
    if (written % rowsPerChunk === 0) {
      yield { text: pending, rows: pendingRows };
      pending = '';
      pendingRows = 0;
    }
  }
  pending += written === 0 ? fmt.empty : fmt.close;
  if (pending !== '') yield { text: pending, rows: pendingRows };
}

/** Joining every chunk's text gives exactly what buildExport returns. */
export function buildExportChunks(
  result: QueryResult,
  format: ExportFormat,
  opts: ExportOptions,
  rowsPerChunk: number = EXPORT_CHUNK_ROWS,
): Generator<ExportChunk> {
  return formatView(subsetView(result, opts), format, result.tableName, rowsPerChunk);
}

export function exportResultToText(result: QueryResult, format: ExportFormat): string {
  let out = '';
  for (const chunk of formatView(allColumnsView(result), format, result.tableName, EXPORT_CHUNK_ROWS)) {
    out += chunk.text;
  }
  return out;
}

export function buildExport(result: QueryResult, format: ExportFormat, opts: ExportOptions): string {
  let out = '';
  for (const chunk of buildExportChunks(result, format, opts)) out += chunk.text;
  return out;
}

export const EXPORT_FORMATS: { id: ExportFormat; label: string; ext: string }[] = [
  { id: 'text', label: 'Text', ext: 'txt' },
  { id: 'csv', label: 'CSV', ext: 'csv' },
  { id: 'json', label: 'JSON', ext: 'json' },
  { id: 'markdown', label: 'Markdown', ext: 'md' },
  { id: 'sql', label: 'SQL INSERT', ext: 'sql' },
];

const STORAGE_KEY = STORAGE_KEYS.exportFormat;

export function readStoredExportFormat(): ExportFormat {
  try {
    const v = settings.getItem(STORAGE_KEY);
    if (v && EXPORT_FORMATS.some((f) => f.id === v)) return v as ExportFormat;
  } catch {
    /* ignore */
  }
  return 'csv';
}

export function storeExportFormat(format: ExportFormat): void {
  try {
    settings.setItem(STORAGE_KEY, format);
  } catch {
    /* ignore */
  }
}

export interface GridCopySelection {
  selectedRows: Iterable<number>;
  selectedColumns: Iterable<string>;
  displayColumns: string[];
  sortedRowIndices: number[];
}

export function resolveCopySelection(state: GridCopySelection): ExportOptions {
  const selectedRows = [...state.selectedRows];
  const selectedColumns = [...state.selectedColumns];
  const hasRows = selectedRows.length > 0;
  const hasCols = selectedColumns.length > 0;

  const sortRows = (indices: number[]) =>
    [...indices].sort((a, b) => state.sortedRowIndices.indexOf(a) - state.sortedRowIndices.indexOf(b));
  const columnsFromSelection = () => state.displayColumns.filter((c) => selectedColumns.includes(c));

  if (hasCols && !hasRows) {
    return {
      columns: columnsFromSelection(),
      rowIndices: [...state.sortedRowIndices],
    };
  }
  if (hasRows && !hasCols) {
    return {
      columns: [...state.displayColumns],
      rowIndices: sortRows(selectedRows),
    };
  }
  if (hasRows && hasCols) {
    return {
      columns: columnsFromSelection(),
      rowIndices: sortRows(selectedRows),
    };
  }
  return {
    columns: [...state.displayColumns],
    rowIndices: [...state.sortedRowIndices],
  };
}

export function formatCellCopyValue(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

export interface FocusedCellCopyContext {
  focusedRowIdx: number | null;
  focusedColPos: number /** -1 = row number column (not a data cell) */;
  selectedRows: Iterable<number>;
  selectedColumns: Iterable<string>;
}

export function shouldCopySingleCell(ctx: FocusedCellCopyContext): boolean {
  const selectedRows = [...ctx.selectedRows];
  const selectedColumns = [...ctx.selectedColumns];
  if (selectedColumns.length > 0) return false;
  if (selectedRows.length > 0) return false;
  if (ctx.focusedRowIdx == null || ctx.focusedColPos < 0) return false;
  return true;
}
