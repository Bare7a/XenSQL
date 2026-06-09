import { primaryKeyKey, rowPrimaryKey } from '@/features/table-view/lib/tableViewRows';
import type { QueryResult, TableViewPendingState } from '@/types';

export function buildTableViewExportResult(
  columns: string[],
  columnTypes: string[],
  rows: unknown[][],
  primaryKeys: string[],
  pending: TableViewPendingState,
  tableName: string,
): QueryResult {
  const exportRows = rows.map((row) => {
    const pk = rowPrimaryKey(row, columns, primaryKeys);
    const edits = pending.edits[primaryKeyKey(pk)];
    return columns.map((col, i) => (edits && col in edits ? edits[col] : row[i]));
  });
  return {
    columns,
    columnTypes,
    rows: exportRows,
    rowCount: exportRows.length,
    affectedRows: 0,
    durationMs: 0,
    tableName,
    primaryKeys,
  };
}
