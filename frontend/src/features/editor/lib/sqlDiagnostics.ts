import { parseQueryContext } from '@/features/editor/lib/sqlQueryParse';
import { parseSqlStatements } from '@/features/editor/lib/sqlStatements';
import type { DriverType, SchemaInfo, TableInfo } from '@/types';

export interface SqlDiagnostic {
  start: number; // absolute offsets into the full buffer
  end: number;
  message: string;
}

// Table references that don't resolve against the live schema - typos caught before the
// round-trip to the server. CTE names are in scope by definition.
export function collectSchemaDiagnostics(
  sql: string,
  tables: TableInfo[],
  schemas: SchemaInfo[],
  driver: DriverType,
): SqlDiagnostic[] {
  const out: SqlDiagnostic[] = [];
  for (const stmt of parseSqlStatements(sql, driver)) {
    const parsed = parseQueryContext(sql.slice(stmt.start, stmt.end), tables, schemas, driver);
    const local = new Set(parsed.ctes.map((c) => c.toLowerCase()));
    for (const ref of parsed.queryTables) {
      if (ref.known || local.has(ref.table.toLowerCase()) || !ref.table.trim()) continue;
      out.push({
        start: stmt.start + ref.nameStart,
        end: stmt.start + ref.nameEnd,
        message: `Unknown table "${ref.table}"`,
      });
    }
  }
  return out;
}
