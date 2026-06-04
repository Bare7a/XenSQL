import type { QueryResult } from '@/types';
import { STORAGE_KEYS } from '@/shared/lib/storageKeys';
import { settings } from '@/shared/lib/settingsStore';

export type ExportFormat = 'csv' | 'json' | 'markdown' | 'sql' | 'text';

export interface ExportOptions {
  columns: string[];
  rowIndices: number[];
}

function pickSubset(result: QueryResult, opts: ExportOptions): QueryResult {
  const colIndices = opts.columns.map((c) => result.columns.indexOf(c)).filter((i) => i >= 0);
  const columns = colIndices.map((i) => result.columns[i]);
  const rows = opts.rowIndices.map((ri) => {
    const row = result.rows[ri];
    if (!row) return colIndices.map(() => null); // guard against a stale out-of-range selection index
    return colIndices.map((i) => row[i]);
  });
  return {
    ...result,
    columns,
    columnTypes: colIndices.map((i) => result.columnTypes?.[i] ?? ''),
    rows,
    rowCount: rows.length,
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

export function exportResultToText(result: QueryResult, format: ExportFormat): string {
  switch (format) {
    case 'json': {
      // Nest JSON/JSONB columns instead of string-wrapping them (matches the row JSON viewer).
      const isJsonCol = result.columns.map((_, i) => /json/i.test(result.columnTypes?.[i] ?? ''));
      const rows = result.rows.map((row) => {
        const m: Record<string, unknown> = {};
        result.columns.forEach((col, i) => {
          const v = row[i];
          m[col] = isJsonCol[i] && typeof v === 'string' ? safeJsonParse(v) : v;
        });
        return m;
      });
      // bigint isn't JSON-serializable; emit it as a number (backend already sends out-of-range ints as strings).
      return JSON.stringify(rows, (_k, val) => (typeof val === 'bigint' ? Number(val) : val), 2);
    }
    case 'csv': {
      const escape = (cell: string) => {
        // Mirror Go's encoding/csv: quote on delimiter/quote/newline, leading whitespace, or \. sentinel.
        const needsQuote =
          cell === '\\.' || /[",\n\r]/.test(cell) || /^\s/u.test(cell);
        if (needsQuote) return `"${cell.replace(/"/g, '""')}"`;
        return cell;
      };
      const lines = [result.columns.map(escape).join(',')];
      for (const row of result.rows) {
        lines.push(
          row
            .map((v) => (v == null ? '' : escape(defuseCsvFormula(String(v)))))
            .join(',')
        );
      }
      return lines.join('\n');
    }
    case 'markdown': {
      // Escape headers too, not just cells - a column named `a|b` would break the alignment.
      const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r\n?|\n/g, ' ');
      const sep = result.columns.map(() => '---');
      const lines = [
        `| ${result.columns.map(mdCell).join(' | ')} |`,
        `| ${sep.join(' | ')} |`,
      ];
      for (const row of result.rows) {
        const cells = row.map((v) => (v == null ? '' : mdCell(String(v))));
        lines.push(`| ${cells.join(' | ')} |`);
      }
      return lines.join('\n');
    }
    case 'sql': {
      const quoteIdent = (id: string) => `"${id.replace(/"/g, '""')}"`;
      const table = quoteIdent(result.tableName || 'results');
      const quotedCols = result.columns.map(quoteIdent);
      const lines: string[] = [];
      for (const row of result.rows) {
        const vals = row.map(sqlLiteral);
        lines.push(
          `INSERT INTO ${table} (${quotedCols.join(', ')}) VALUES (${vals.join(', ')});`
        );
      }
      return lines.join('\n');
    }
    case 'text': {
      return result.rows
        .map((row) =>
          row.map((v) => (v == null ? '' : String(v))).join('\t')
        )
        .join('\n');
    }
    default:
      return '';
  }
}

export function buildExport(
  result: QueryResult,
  format: ExportFormat,
  opts: ExportOptions
): string {
  const subset = pickSubset(result, opts);
  return exportResultToText(subset, format);
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
    [...indices].sort(
      (a, b) => state.sortedRowIndices.indexOf(a) - state.sortedRowIndices.indexOf(b)
    );
  const columnsFromSelection = () =>
    state.displayColumns.filter((c) => selectedColumns.includes(c));

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
  focusedColPos: number; /** -1 = row number column (not a data cell) */
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
