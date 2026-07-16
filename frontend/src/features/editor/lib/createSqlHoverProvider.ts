import type { editor, languages } from 'monaco-editor';
import { analyzeHover, columnHoverLines } from '@/features/editor/lib/sqlHover';
import { parseQueryContext } from '@/features/editor/lib/sqlQueryParse';
import { currentStatementRange, parseSqlStatements } from '@/features/editor/lib/sqlStatements';
import type { ColumnInfo, DriverType, SchemaInfo, TableInfo } from '@/types';

export interface HoverProviderCtx {
  schemas: SchemaInfo[];
  allTables: TableInfo[];
  onLoadColumns: (schema: string, table: string) => Promise<ColumnInfo[]>;
  driver: DriverType;
}

export function createSqlHoverProvider(
  ed: editor.IStandaloneCodeEditor,
  getCtx: () => HoverProviderCtx,
): languages.HoverProvider {
  return {
    provideHover: async (model, position) => {
      if (model !== ed.getModel()) return null;
      const { schemas, allTables, onLoadColumns, driver } = getCtx();

      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const { start, end } = currentStatementRange(parseSqlStatements(text, driver), offset, text.length);
      const stmt = text.slice(start, end);
      const parsed = parseQueryContext(stmt, allTables, schemas, driver);
      const query = analyzeHover(stmt, offset - start, parsed, allTables, schemas, driver);
      if (!query) return null;

      const s = model.getPositionAt(start + query.start);
      const e = model.getPositionAt(start + query.end);
      const range = {
        startLineNumber: s.lineNumber,
        startColumn: s.column,
        endLineNumber: e.lineNumber,
        endColumn: e.column,
      };

      if (query.lines) {
        return { range, contents: query.lines.map((value) => ({ value })) };
      }
      if (query.columnLookup) {
        for (const binding of query.columnLookup.bindings) {
          const cols = await onLoadColumns(binding.schema, binding.table);
          const col = cols.find((c) => c.name.toLowerCase() === query.columnLookup?.name);
          if (col) {
            return { range, contents: columnHoverLines(col, binding).map((value) => ({ value })) };
          }
        }
      }
      return null;
    },
  };
}
