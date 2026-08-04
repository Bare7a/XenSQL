import { formatSqlIdentifier } from '@/features/editor/lib/sqlQuoting';
import type { ColumnInfo, DriverType } from '@/types';

export interface ForeignKeyTarget {
  table: string;
  /** Empty when the FK implicitly references the target's primary key (SQLite). */
  column: string;
}

export function foreignKeyTargetsFrom(cols: ColumnInfo[]): Record<string, ForeignKeyTarget> {
  const targets: Record<string, ForeignKeyTarget> = {};
  for (const col of cols) {
    if (!col.isForeign || !col.foreignTable) continue;
    targets[col.name] = { table: col.foreignTable, column: col.foreignColumn ?? '' };
  }
  return targets;
}

// Numeric-looking strings stay quoted: unquoting a text key like '007' would match the wrong row.
function sqlValueLiteral(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : `'${value}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function buildForeignKeyFilter(column: string, value: unknown, driver: DriverType): string {
  const ident = formatSqlIdentifier(column, driver);
  if (value == null) return `${ident} IS NULL`;
  return `${ident} = ${sqlValueLiteral(value)}`;
}
