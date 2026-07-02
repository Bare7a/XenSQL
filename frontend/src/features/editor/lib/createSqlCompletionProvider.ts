import type { Monaco } from '@monaco-editor/react';
import type { editor, languages } from 'monaco-editor';
import {
  bindingsNeedingColumns,
  buildCompletionItems,
  completionReplaceRange,
} from '@/features/editor/lib/sqlCompletion';
import { parseQueryContext } from '@/features/editor/lib/sqlQueryParse';
import { columnCacheKey } from '@/features/editor/lib/sqlQuoting';
import { currentStatementRange, parseSqlStatements } from '@/features/editor/lib/sqlStatements';
import type { CompletionContext, CompletionItem } from '@/features/editor/lib/sqlSuggestions';
import type { ColumnInfo, DriverType, SchemaInfo, TableInfo } from '@/types';

function toMonacoCompletion(
  item: CompletionItem,
  monaco: Monaco,
  range: {
    startLineNumber: number;
    endLineNumber: number;
    startColumn: number;
    endColumn: number;
  },
): languages.CompletionItem {
  const Kind = monaco.languages.CompletionItemKind;
  const kind =
    item.kind === 'keyword'
      ? Kind.Keyword
      : item.kind === 'field'
        ? Kind.Field
        : item.kind === 'class'
          ? Kind.Class
          : Kind.Module;
  return {
    label: item.label,
    kind,
    insertText: item.insertText,
    detail: item.detail,
    range,
    sortText: item.sortText,
    filterText: item.filterText,
  };
}

export interface CompletionProviderCtx {
  schemas: SchemaInfo[];
  allTables: TableInfo[];
  tablesBySchema: Record<string, TableInfo[]>;
  onLoadColumns: (schema: string, table: string) => Promise<ColumnInfo[]>;
  driver: DriverType;
}

export function createSqlCompletionProvider(
  monaco: Monaco,
  ed: editor.IStandaloneCodeEditor,
  getCtx: () => CompletionProviderCtx,
): languages.CompletionItemProvider {
  return {
    triggerCharacters: ['.', ' ', ',', '='],
    provideCompletionItems: async (model, position) => {
      if (model !== ed.getModel()) {
        return { suggestions: [] };
      }

      const { schemas, allTables, tablesBySchema, onLoadColumns: loadCols, driver } = getCtx();

      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      // Scope to the current statement so clause context and table bindings don't leak across `;`.
      const { start: statementStart, end: statementEnd } = currentStatementRange(
        parseSqlStatements(text),
        offset,
        text.length,
      );
      const textBefore = text.slice(statementStart, offset);

      // Parse only the current statement; loadCols is cached per connection.
      const parsed = parseQueryContext(text.slice(statementStart, statementEnd), allTables, schemas, driver);
      const columnsByTable: Record<string, ColumnInfo[]> = {};
      for (const ref of bindingsNeedingColumns(textBefore, parsed, {
        tables: allTables,
        schemas,
        driver,
      })) {
        const key = columnCacheKey(ref.schema, ref.table);
        if (!columnsByTable[key]) {
          columnsByTable[key] = await loadCols(ref.schema, ref.table);
        }
      }

      const ctx: CompletionContext = {
        schemas,
        tables: allTables,
        columns: [],
        tablesBySchema,
        columnsByTable,
        driver,
      };

      const word = model.getWordUntilPosition(position);
      const items = buildCompletionItems({ ctx, text, position: offset, parsed, statementStart });
      const range = completionReplaceRange(position, textBefore, {
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      });
      return {
        suggestions: items.map((item) => toMonacoCompletion(item, monaco, range)),
      };
    },
  };
}
