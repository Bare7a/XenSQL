import {
  clauseBodyStart,
  type DotCompletion,
  expectsExpression,
  isColumnFilterContext,
  isLimitOffsetContext,
  isOrderOrGroupContext,
  isUpdateSetColumnContext,
  isValueContext,
  matchTableContext,
  parseDotCompletion,
  sortDirectionAllowed,
  updateSetColumnPrefix,
  valueContextPrefix,
} from '@/features/editor/lib/sqlCompletionContext';
import {
  type ParsedQuery,
  type QueryTableRef,
  resolveDotCompletion,
  resolveQualifierToTable,
  type TableBinding,
} from '@/features/editor/lib/sqlQueryParse';
import { columnCacheKey, formatSqlIdentifier, unquoteIdent } from '@/features/editor/lib/sqlQuoting';
import {
  type CompletionContext,
  type CompletionItem,
  columnDetail,
  keywordsForContext,
  matchScore,
  rank,
  suggestClauseBody,
  suggestColumnsForTable,
  suggestColumnsFromBindings,
  suggestCteItems,
  suggestLimitOffset,
  suggestQueryTableRefs,
  suggestSchemas,
  suggestTables,
  suggestValueItems,
} from '@/features/editor/lib/sqlSuggestions';
import type { DriverType, SchemaInfo, TableInfo } from '@/types';

export {
  type ClauseBodyKind,
  clauseBodyStart,
  type DotCompletion,
  expectsExpression,
  isColumnFilterContext,
  isLimitOffsetContext,
  isOrderOrGroupContext,
  isUpdateSetColumnContext,
  isValueContext,
  matchTableContext,
  parseDotCompletion,
  type TableContextMatch,
} from '@/features/editor/lib/sqlCompletionContext';
export {
  type ParsedQuery,
  parseQueryContext,
  parseTableRef,
  type QueryTableRef,
  resolveDotCompletion,
  resolveQualifierToTable,
  resolveTableName,
  type TableBinding,
} from '@/features/editor/lib/sqlQueryParse';
export {
  ALIAS_STOP_WORDS,
  columnCacheKey,
  formatSqlIdentifier,
  identifierNeedsQuote,
  QUOTE_FORCING_KEYWORDS,
  unquoteIdent,
} from '@/features/editor/lib/sqlQuoting';
export {
  columnDetail,
  JOIN_KEYWORDS,
  keywordsForContext,
  matchScore,
  ORDER_KEYWORDS,
  rank,
  SQL_KEYWORDS,
  suggestClauseBody,
  suggestColumnsForTable,
  suggestColumnsFromBindings,
  suggestCteItems,
  suggestLimitOffset,
  suggestQueryTableRefs,
  suggestSchemas,
  suggestTables,
  suggestValueItems,
  VALUE_LITERALS,
} from '@/features/editor/lib/sqlSuggestions';
export type { CompletionContext, CompletionItem };

export interface BindingsNeedingColumnsCtx {
  tables: TableInfo[];
  schemas: SchemaInfo[];
  driver: DriverType;
}

export function bindingsNeedingColumns(
  before: string,
  parsed: ParsedQuery,
  ctx?: BindingsNeedingColumnsCtx,
): TableBinding[] {
  const needed: TableBinding[] = [];
  const seen = new Set<string>();

  const add = (b: TableBinding | null) => {
    if (!b) return;
    const k = columnCacheKey(b.schema, b.table);
    if (seen.has(k)) return;
    seen.add(k);
    needed.push(b);
  };

  // clauseBodyStart position needs all in-scope columns; table position needs none (table list is known).
  const body = clauseBodyStart(before);
  if (body) {
    if (body !== 'table') {
      for (const ref of parsed.queryTables) add({ schema: ref.schema, table: ref.table });
    }
    return needed;
  }

  if (isValueContext(before)) {
    for (const b of parsed.bindings.values()) add(b);
    if (seen.size === 0) {
      for (const ref of parsed.queryTables) add({ schema: ref.schema, table: ref.table });
    }
    return needed;
  }

  if (isUpdateSetColumnContext(before) || isColumnFilterContext(before) || isOrderOrGroupContext(before)) {
    for (const ref of parsed.queryTables) add({ schema: ref.schema, table: ref.table });
    return needed;
  }

  const dot = parseDotCompletion(before);
  if (dot) {
    if (ctx) {
      // Full resolution handles schema.table.column and tables outside the current FROM clause.
      add(resolveDotCompletion(dot, parsed.bindings, ctx.tables, ctx.schemas, ctx.driver));
    } else {
      const qual = unquoteIdent(dot.segments[0]).toLowerCase();
      const fromAlias = parsed.bindings.get(qual);
      if (fromAlias) add(fromAlias);
    }
    return needed;
  }

  for (const b of parsed.bindings.values()) add(b);
  return needed;
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

function dotCompletionItems(
  ctx: CompletionContext,
  dot: DotCompletion,
  bindings: Map<string, TableBinding>,
): CompletionItem[] | null {
  const tableRef = resolveDotCompletion(dot, bindings, ctx.tables, ctx.schemas, ctx.driver);
  if (tableRef) return suggestColumnsForTable(ctx, tableRef, dot.prefix.toLowerCase());

  if (dot.segments.length === 1) {
    const schemaName = unquoteIdent(dot.segments[0]);
    if (schemaTablesFor(ctx, schemaName).length > 0) {
      return suggestTables(ctx, dot.prefix.toLowerCase(), schemaName);
    }
  }
  return null;
}

function orderGroupItems(
  ctx: CompletionContext,
  before: string,
  queryTables: QueryTableRef[],
  bindings: Map<string, TableBinding>,
): CompletionItem[] {
  const frag = before.match(/[\w"`]*$/)?.[0] ?? '';
  const lcPrefix = unquoteIdent(frag).toLowerCase();
  // Columns/tables only at the start of a sort term (after BY/comma), not after a finished one.
  const items: CompletionItem[] = expectsExpression(before)
    ? [...suggestQueryTableRefs(ctx, queryTables, lcPrefix), ...suggestColumnsFromBindings(ctx, bindings, lcPrefix)]
    : [];
  if (sortDirectionAllowed(before)) {
    for (const kw of ['ASC', 'DESC']) {
      const score = matchScore(kw, lcPrefix);
      if (score >= 0) {
        items.push({ label: kw, kind: 'keyword', insertText: kw, sortText: rank(4, score, kw) });
      }
    }
  }
  // After a finished term, continue to LIMIT/OFFSET (plus HAVING/ORDER BY when grouping).
  if (!expectsExpression(before)) {
    const re = /\b(ORDER|GROUP)\s+BY\b/gi;
    let kind = '';
    for (let mm = re.exec(before); mm !== null; mm = re.exec(before)) kind = mm[1].toUpperCase();
    const trailing = kind === 'GROUP' ? ['HAVING', 'ORDER BY', 'LIMIT', 'OFFSET'] : ['LIMIT', 'OFFSET'];
    for (const kw of trailing) {
      const score = matchScore(kw, lcPrefix);
      if (score >= 0) {
        items.push({ label: kw, kind: 'keyword', insertText: kw, sortText: rank(4, score, kw) });
      }
    }
  }
  return items;
}

function bareWordItems(
  ctx: CompletionContext,
  before: string,
  lcPrefix: string,
  queryTables: QueryTableRef[],
  bindings: Map<string, TableBinding>,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const inFilter = isColumnFilterContext(before);
  // Identifiers only when the preceding token expects one; keywords always flow through.
  const wantExpr = expectsExpression(before);
  if (inFilter && wantExpr) {
    items.push(...suggestQueryTableRefs(ctx, queryTables, lcPrefix));
    items.push(...suggestColumnsFromBindings(ctx, bindings, lcPrefix));
  }

  for (const kw of keywordsForContext(before)) {
    const score = matchScore(kw, lcPrefix);
    if (score < 0) continue;
    items.push({
      label: kw,
      kind: 'keyword',
      insertText: kw,
      sortText: rank(4, score, kw),
    });
  }

  if (wantExpr && /\bSELECT\s+[^;]*$/i.test(before) && !/\bFROM\b/i.test(before)) {
    items.push(...suggestColumnsFromBindings(ctx, bindings, lcPrefix));
  }
  if (wantExpr && !/\bFROM\b/i.test(before) && !inFilter) {
    items.push(...suggestSchemas(ctx, lcPrefix));
  }
  return items;
}

function qualifiedItems(
  ctx: CompletionContext,
  parts: string[],
  lcPrefix: string,
  bindings: Map<string, TableBinding>,
): CompletionItem[] {
  if (parts.length === 2) {
    const qualifier = unquoteIdent(parts[0]);
    const tableRef = resolveQualifierToTable(qualifier, bindings, ctx.tables, ctx.schemas, ctx.driver);
    if (tableRef) return suggestColumnsForTable(ctx, tableRef, lcPrefix);

    if (schemaTablesFor(ctx, qualifier).length > 0) {
      return suggestTables(ctx, lcPrefix, qualifier);
    }
    return suggestSchemas(ctx, lcPrefix);
  }

  const schemaName = unquoteIdent(parts[0]);
  const tableName = unquoteIdent(parts[1]);
  const key = columnCacheKey(schemaName, tableName);
  const cols = ctx.columnsByTable[key] || ctx.columns;
  const items: CompletionItem[] = [];
  for (const c of cols) {
    const score = matchScore(c.name, lcPrefix);
    if (score < 0) continue;
    items.push({
      label: c.name,
      kind: 'field',
      detail: columnDetail(c),
      insertText: formatSqlIdentifier(c.name, ctx.driver),
      sortText: rank(0, score, c.name),
    });
  }
  return items;
}

function completionItems(input: BuildCompletionInput): CompletionItem[] {
  const { ctx, text: textVal, position: posVal, parsed } = input;
  const before = textVal.slice(input.statementStart ?? 0, posVal);
  const { queryTables, bindings } = parsed;

  const dot = parseDotCompletion(before);
  if (dot) {
    const fromDot = dotCompletionItems(ctx, dot, bindings);
    if (fromDot) return fromDot;
  }

  const bodyKind = clauseBodyStart(before);
  if (bodyKind) return suggestClauseBody(ctx, bodyKind, queryTables, bindings, parsed.ctes);

  if (isUpdateSetColumnContext(before)) {
    return suggestColumnsFromBindings(ctx, bindings, updateSetColumnPrefix(before));
  }

  if (isValueContext(before)) {
    return suggestValueItems(ctx, queryTables, bindings, valueContextPrefix(before));
  }

  const tableCtx = matchTableContext(before);
  if (tableCtx) {
    // CTEs join the table list (not under a schema qualifier - CTEs aren't schemas), first so they
    // survive the 100-item slice on a large schema.
    return tableCtx.schemaPrefix
      ? suggestTables(ctx, tableCtx.prefix, tableCtx.schemaPrefix)
      : [...suggestCteItems(parsed.ctes, tableCtx.prefix, ctx.driver), ...suggestTables(ctx, tableCtx.prefix)];
  }

  if (isOrderOrGroupContext(before)) {
    return orderGroupItems(ctx, before, queryTables, bindings);
  }

  // LIMIT/OFFSET take a number (+ optional OFFSET), not columns/tables/keywords.
  if (isLimitOffsetContext(before)) {
    return suggestLimitOffset(before, before.match(/[\w]+$/)?.[0].toLowerCase() ?? '');
  }

  const wordMatch = before.match(/[\w."`]*$/);
  const word = wordMatch ? wordMatch[0] : '';
  const parts = word.split('.');
  const lcPrefix = parts[parts.length - 1].toLowerCase();

  if (parts.length === 1) return bareWordItems(ctx, before, lcPrefix, queryTables, bindings);
  if (parts.length === 2 || parts.length === 3) {
    return qualifiedItems(ctx, parts, lcPrefix, bindings);
  }
  return [];
}

export function buildCompletionItems(input: BuildCompletionInput): CompletionItem[] {
  return completionItems(input).slice(0, 100);
}

// Length of the partial identifier under the caret (what the completion replaces). A leading quote
// counts only when unclosed; matching `"[^"]*$` naively instead grabs from an earlier closing quote
// (`"Users" WHERE ` → `" WHERE `), a bogus range that hid WHERE suggestions after a quoted table.
function identifierFragmentLength(textBefore: string): number {
  const line = textBefore.slice(textBefore.lastIndexOf('\n') + 1);
  for (const q of ['"', '`']) {
    if ((line.split(q).length - 1) % 2 === 1) return line.length - line.lastIndexOf(q);
  }
  return line.match(/[\w]+$/)?.[0].length ?? 0;
}

function identifierFragmentRange(
  position: { lineNumber: number; column: number },
  textBefore: string,
  fallback: { startColumn: number; endColumn: number },
): { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number } {
  const fragLen = identifierFragmentLength(textBefore);
  if (fragLen > 0) {
    return {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: Math.max(1, position.column - fragLen),
      endColumn: position.column,
    };
  }
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: fallback.startColumn,
    endColumn: fallback.endColumn,
  };
}

export function completionReplaceRange(
  position: { lineNumber: number; column: number },
  textBefore: string,
  fallback: { startColumn: number; endColumn: number },
): { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number } {
  // clauseBodyStart: zero-width insert at caret; suggestClauseBody space-prefixes so it reads cleanly.
  if (clauseBodyStart(textBefore)) {
    return {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: position.column,
      endColumn: position.column,
    };
  }
  const dot = parseDotCompletion(textBefore);
  if (dot) {
    return {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: Math.max(1, position.column - dot.prefix.length),
      endColumn: position.column,
    };
  }
  if (isValueContext(textBefore)) {
    // Cover any started quote + partial so accepting replaces `'ab` rather than appending to it.
    const consumed = textBefore.match(/['"`]?[\w."`]*$/)?.[0].length ?? 0;
    return {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: Math.max(1, position.column - consumed),
      endColumn: position.column,
    };
  }
  if (isUpdateSetColumnContext(textBefore)) {
    const prefix = updateSetColumnPrefix(textBefore);
    return {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: Math.max(1, position.column - prefix.length),
      endColumn: position.column,
    };
  }
  const tableCtx = matchTableContext(textBefore);
  if (tableCtx) {
    return {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: Math.max(1, position.column - tableCtx.prefix.length),
      endColumn: position.column,
    };
  }
  return identifierFragmentRange(position, textBefore, fallback);
}
