import {
  analyzeSqlCursor,
  type CursorSlot,
  type SqlCursor,
  type StatementShape,
} from '@/features/editor/lib/sqlContext';
import {
  type ParsedQuery,
  type QueryTableRef,
  resolveDotCompletion,
  type TableBinding,
} from '@/features/editor/lib/sqlQueryParse';
import { columnCacheKey, formatSqlIdentifier, unquoteIdent } from '@/features/editor/lib/sqlQuoting';
import {
  type CompletionContext,
  type CompletionItem,
  keywordItem,
  keywordsForShape,
  rank,
  suggestColumnsForTable,
  suggestColumnsInScope,
  suggestCteItems,
  suggestQueryTableRefs,
  suggestSchemas,
  suggestTables,
  suggestValueItems,
  suggestVirtualColumns,
  withLeadingSpace,
} from '@/features/editor/lib/sqlSuggestions';
import { t } from '@/i18n';
import type { DriverType, SchemaInfo, TableInfo } from '@/types';

export interface BindingsNeedingColumnsCtx {
  tables: TableInfo[];
  schemas: SchemaInfo[];
  driver: DriverType;
}

// Which tables' columns the completion at this position can show, so the provider prefetches exactly those.
export function bindingsNeedingColumns(
  before: string,
  parsed: ParsedQuery,
  ctx?: BindingsNeedingColumnsCtx,
): TableBinding[] {
  const { slot } = analyzeSqlCursor(before, ctx?.driver);
  const needed: TableBinding[] = [];
  const seen = new Set<string>();
  const add = (b: TableBinding | null) => {
    if (!b) return;
    const k = columnCacheKey(b.schema, b.table);
    if (seen.has(k)) return;
    seen.add(k);
    needed.push(b);
  };
  // CTEs / derived-table aliases have no schema entry to load columns from.
  const isVirtual = (name: string) => parsed.virtualColumns.has(name.toLowerCase());
  const addQueryTables = () => {
    for (const ref of parsed.queryTables) {
      if (!isVirtual(ref.table)) add({ schema: ref.schema, table: ref.table });
    }
  };
  const addBindings = () => {
    for (const b of parsed.bindings.values()) {
      if (!isVirtual(b.table)) add(b);
    }
  };

  switch (slot.kind) {
    case 'none':
    case 'table':
    case 'limit':
      return needed;
    case 'dot': {
      if (isVirtual(unquoteIdent(slot.segments[0]))) return needed;
      if (ctx) {
        // Full resolution handles schema.table.column and tables outside the current FROM clause.
        add(resolveDotCompletion(slot, parsed.bindings, ctx.tables, ctx.schemas, ctx.driver));
      } else {
        const fromAlias = parsed.bindings.get(unquoteIdent(slot.segments[0]).toLowerCase());
        if (fromAlias) add(fromAlias);
      }
      return needed;
    }
    case 'value':
      addBindings();
      if (seen.size === 0) addQueryTables();
      return needed;
    case 'filter-start':
    case 'set-column':
    case 'insert-columns':
    case 'order-group':
      addQueryTables();
      return needed;
    case 'general':
      if (slot.inFilter) addQueryTables();
      else addBindings();
      return needed;
  }
}

export interface BuildCompletionInput {
  ctx: CompletionContext;
  text: string;
  position: number;
  parsed: ParsedQuery;
  /** Offset of the current statement's start, so clause context (WHERE/SET/…) doesn't leak across `;`. Defaults to 0. */
  statementStart?: number;
}

function schemaTablesFor(ctx: CompletionContext, schemaName: string): TableInfo[] {
  return (
    ctx.tablesBySchema[schemaName] || ctx.tables.filter((t) => t.schema.toLowerCase() === schemaName.toLowerCase())
  );
}

// `a.fk = b.pk` conditions after ON, from the joined tables' FK metadata (both directions).
function fkJoinItems(ctx: CompletionContext, queryTables: QueryTableRef[]): CompletionItem[] {
  const items: CompletionItem[] = [];
  const refs = queryTables.filter(
    (r, i, arr) => arr.findIndex((x) => x.schema === r.schema && x.table === r.table) === i,
  );
  const qualify = (ref: QueryTableRef, column: string) =>
    `${formatSqlIdentifier(ref.alias ?? ref.table, ctx.driver)}.${formatSqlIdentifier(column, ctx.driver)}`;

  for (const from of refs) {
    const cols = ctx.columnsByTable[columnCacheKey(from.schema, from.table)] || [];
    for (const col of cols) {
      if (!col.foreignTable || !col.foreignColumn) continue;
      const target = refs.find((r) => r !== from && r.table.toLowerCase() === col.foreignTable?.toLowerCase());
      if (!target) continue;
      const expr = `${qualify(from, col.name)} = ${qualify(target, col.foreignColumn)}`;
      items.push({
        label: expr,
        kind: 'field',
        detail: t('editor.sql.foreignKey'),
        insertText: expr,
        sortText: rank(0, 0, expr),
      });
    }
  }
  return items;
}

function virtualDetail(parsed: ParsedQuery, nameLc: string): string {
  return parsed.ctes.some((c) => c.toLowerCase() === nameLc)
    ? t('editor.sql.cteColumn')
    : t('editor.sql.subqueryColumn');
}

// Derived-table aliases are always in scope; CTEs only once referenced in FROM/JOIN.
function inScopeVirtualColumnItems(ctx: CompletionContext, parsed: ParsedQuery, lcPrefix: string): CompletionItem[] {
  const cteNames = new Set(parsed.ctes.map((c) => c.toLowerCase()));
  const referenced = new Set(parsed.queryTables.map((t) => t.table.toLowerCase()));
  const items: CompletionItem[] = [];
  for (const [name, cols] of parsed.virtualColumns) {
    if (cteNames.has(name) && !referenced.has(name)) continue;
    items.push(...suggestVirtualColumns(cols, lcPrefix, ctx.driver, virtualDetail(parsed, name)));
  }
  return items;
}

function dotItems(
  ctx: CompletionContext,
  slot: Extract<CursorSlot, { kind: 'dot' }>,
  parsed: ParsedQuery,
): CompletionItem[] {
  if (slot.segments.length === 1) {
    const nameLc = unquoteIdent(slot.segments[0]).toLowerCase();
    const virtual = parsed.virtualColumns.get(nameLc);
    if (virtual) {
      return suggestVirtualColumns(virtual, slot.prefix.toLowerCase(), ctx.driver, virtualDetail(parsed, nameLc));
    }
  }

  const tableRef = resolveDotCompletion(slot, parsed.bindings, ctx.tables, ctx.schemas, ctx.driver);
  if (tableRef) return suggestColumnsForTable(ctx, tableRef, slot.prefix.toLowerCase());

  if (slot.segments.length === 1) {
    const schemaName = unquoteIdent(slot.segments[0]);
    if (schemaTablesFor(ctx, schemaName).length > 0) {
      return suggestTables(ctx, slot.prefix.toLowerCase(), schemaName);
    }
  }
  return [];
}

function tableSlotItems(ctx: CompletionContext, prefix: string, ctes: string[]): CompletionItem[] {
  // CTEs lead (tier 0) so they survive the item cap on large schemas.
  return [...suggestCteItems(ctes, prefix, ctx.driver), ...suggestTables(ctx, prefix), ...suggestSchemas(ctx, prefix)];
}

function orderGroupItems(
  ctx: CompletionContext,
  slot: Extract<CursorSlot, { kind: 'order-group' }>,
  queryTables: QueryTableRef[],
): CompletionItem[] {
  // Columns/tables only at the start of a sort term (after BY/comma), not after a finished one.
  const items: CompletionItem[] = slot.expectsExpr
    ? [
        ...suggestQueryTableRefs(ctx, queryTables, slot.prefix),
        ...suggestColumnsInScope(ctx, queryTables, slot.prefix),
      ]
    : [];
  const keywords = slot.directionAllowed ? ['ASC', 'DESC', ...slot.trailingKeywords] : slot.trailingKeywords;
  for (const kw of keywords) {
    const item = keywordItem(kw, slot.prefix);
    if (item) items.push(item);
  }
  return items;
}

function generalItems(
  ctx: CompletionContext,
  slot: Extract<CursorSlot, { kind: 'general' }>,
  shape: StatementShape,
  parsed: ParsedQuery,
): CompletionItem[] {
  const { queryTables } = parsed;
  const items: CompletionItem[] = [];
  // Identifiers only when the preceding token expects one; keywords always flow through.
  if (slot.inFilter && slot.expectsExpr) {
    if (shape.afterOnKeyword && slot.prefix === '') items.push(...fkJoinItems(ctx, queryTables));
    items.push(...suggestQueryTableRefs(ctx, queryTables, slot.prefix));
    items.push(...suggestColumnsInScope(ctx, queryTables, slot.prefix));
    items.push(...inScopeVirtualColumnItems(ctx, parsed, slot.prefix));
  }

  for (const kw of keywordsForShape(shape, ctx.driver)) {
    const item = keywordItem(kw, slot.prefix);
    if (item) items.push(item);
  }

  if (slot.expectsExpr && shape.inSelectList) {
    // Include table refs so SELECT-list edits can qualify columns.
    items.push(...suggestQueryTableRefs(ctx, queryTables, slot.prefix));
    items.push(...suggestColumnsInScope(ctx, queryTables, slot.prefix));
  }
  if (slot.expectsExpr && !shape.hasFrom && !slot.inFilter) {
    items.push(...suggestSchemas(ctx, slot.prefix));
  }
  return items;
}

function completionItems(input: BuildCompletionInput, cursor: SqlCursor): CompletionItem[] {
  const { ctx, parsed } = input;
  const { slot, shape } = cursor;
  const { queryTables } = parsed;

  switch (slot.kind) {
    case 'none':
      return [];
    case 'dot':
      return dotItems(ctx, slot, parsed);
    case 'table': {
      const items = tableSlotItems(ctx, slot.prefix, parsed.ctes);
      return slot.leadingSpace ? withLeadingSpace(items) : items;
    }
    case 'insert-columns': {
      const used = new Set(slot.used);
      return suggestColumnsInScope(ctx, queryTables, slot.prefix).filter(
        (item) => !used.has(item.label.toLowerCase()),
      );
    }
    case 'set-column': {
      const items = suggestColumnsInScope(ctx, queryTables, slot.prefix);
      return slot.leadingSpace ? withLeadingSpace(items) : items;
    }
    case 'filter-start':
      return withLeadingSpace([
        ...(shape.afterOnKeyword ? fkJoinItems(ctx, queryTables) : []),
        ...suggestQueryTableRefs(ctx, queryTables, ''),
        ...suggestColumnsInScope(ctx, queryTables, ''),
        ...inScopeVirtualColumnItems(ctx, parsed, ''),
      ]);
    case 'value':
      return [
        ...suggestValueItems(ctx, queryTables, slot.prefix),
        ...inScopeVirtualColumnItems(ctx, parsed, slot.prefix),
      ];
    case 'order-group': {
      const items = orderGroupItems(ctx, slot, queryTables);
      if (slot.expectsExpr) items.push(...inScopeVirtualColumnItems(ctx, parsed, slot.prefix));
      return slot.leadingSpace ? withLeadingSpace(items) : items;
    }
    case 'limit': {
      const item = slot.offerOffset ? keywordItem('OFFSET', slot.prefix) : null;
      return item ? [item] : [];
    }
    case 'general':
      return generalItems(ctx, slot, shape, parsed);
  }
}

export function buildCompletionItems(input: BuildCompletionInput): CompletionItem[] {
  const before = input.text.slice(input.statementStart ?? 0, input.position);
  const items = completionItems(input, analyzeSqlCursor(before, input.ctx.driver));
  if (items.length <= 100) return items;

  // Keep the best-ranked 100: sortText leads with `${tier}${score}`, so bucketing on those two
  // characters selects the top ranks without a full sort; Monaco re-sorts survivors by sortText.
  const buckets = new Map<string, CompletionItem[]>();
  for (const item of items) {
    const key = (item.sortText ?? '99').slice(0, 2);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const out: CompletionItem[] = [];
  for (const key of [...buckets.keys()].sort()) {
    for (const item of buckets.get(key) ?? []) {
      out.push(item);
      if (out.length === 100) return out;
    }
  }
  return out;
}

export function completionReplaceRange(
  position: { lineNumber: number; column: number },
  textBefore: string,
  fallback: { startColumn: number; endColumn: number },
  driver?: DriverType,
): { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number } {
  const { slot } = analyzeSqlCursor(textBefore, driver);
  const at = (startColumn: number, endColumn: number) => ({
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn,
    endColumn,
  });

  // Clause-start slots insert space-prefixed at the caret; nothing gets replaced.
  if ('leadingSpace' in slot && slot.leadingSpace) return at(position.column, position.column);
  if (slot.kind === 'none') return at(fallback.startColumn, fallback.endColumn);

  const replaceLen = 'replaceLen' in slot ? slot.replaceLen : 0;
  if (replaceLen > 0) return at(Math.max(1, position.column - replaceLen), position.column);
  // No partial word: general falls back to Monaco's word range, structured slots insert at the caret.
  if (slot.kind === 'general') return at(fallback.startColumn, fallback.endColumn);
  return at(position.column, position.column);
}
