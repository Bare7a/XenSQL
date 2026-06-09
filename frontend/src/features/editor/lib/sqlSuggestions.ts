import { type ClauseBodyKind, isValueContext } from '@/features/editor/lib/sqlCompletionContext';
import type { QueryTableRef, TableBinding } from '@/features/editor/lib/sqlQueryParse';
import { columnCacheKey, formatSqlIdentifier } from '@/features/editor/lib/sqlQuoting';
import type { ColumnInfo, DriverType, SchemaInfo, TableInfo } from '@/types';

export interface CompletionContext {
  schemas: SchemaInfo[];
  tables: TableInfo[];
  columns: ColumnInfo[];
  tablesBySchema: Record<string, TableInfo[]>;
  columnsByTable: Record<string, ColumnInfo[]>;
  driver: DriverType;
}

export interface CompletionItem {
  label: string;
  kind: 'keyword' | 'field' | 'class' | 'module'; // Monaco icon category
  detail?: string;
  insertText: string;
  // What Monaco fuzzy-matches against (defaults to label). Quote-requiring identifiers set the
  // quoted form so typing the opening `"` still matches; the label stays bare for display.
  filterText?: string;
  sortText?: string; // lower lex = higher in list
}

export const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'ON',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'BETWEEN',
  'IS NULL',
  'IS NOT NULL',
  'AS',
  'DISTINCT',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'UNION',
  'UNION ALL',
  'EXISTS',
  'CAST',
  'ASC',
  'DESC',
  'NULL',
];

export const JOIN_KEYWORDS = new Set([
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'FULL JOIN',
  'CROSS JOIN',
  'OUTER JOIN',
]);

export const ORDER_KEYWORDS = new Set(['ASC', 'DESC', 'ORDER BY']);

export const VALUE_LITERALS = ['NULL', 'TRUE', 'FALSE', 'DEFAULT'];

// Keywords that can only begin a statement - offered just at the statement start, never mid-query.
const STATEMENT_STARTERS = new Set([
  'SELECT',
  'INSERT INTO',
  'UPDATE',
  'DELETE',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
]);

export function keywordsForContext(before: string): string[] {
  const afterOrderBy = /\bORDER\s+BY\s+[^;]*$/i.test(before);
  const afterGroupBy = /\bGROUP\s+BY\s+[^;]*$/i.test(before);
  const inWhere = /\bWHERE\b/i.test(before);
  const hasFrom = /\bFROM\b/i.test(before);
  const inSelectList = /\bSELECT\s+[^;]*$/i.test(before) && !hasFrom;
  // Only an optional leading word remains → we're at the very start of the statement.
  const atStatementStart = /^\s*[\w]*$/.test(before);

  let allowed = SQL_KEYWORDS.filter((kw) => {
    if (ORDER_KEYWORDS.has(kw) && !afterOrderBy) return false;
    if (kw === 'GROUP BY' || kw === 'HAVING') {
      if (!afterGroupBy && !inSelectList) return false;
    }
    if (JOIN_KEYWORDS.has(kw)) {
      if (!hasFrom || inWhere || isValueContext(before)) return false;
    }
    if (kw === 'FROM' && hasFrom) return false;
    if (kw === 'WHERE' && inWhere) return false;
    // Clause keywords that only belong with their statement/construct.
    if (STATEMENT_STARTERS.has(kw) && !atStatementStart) return false;
    if (kw === 'ON' && !/\bJOIN\b/i.test(before)) return false;
    if (kw === 'VALUES' && !/\bINSERT\b/i.test(before)) return false;
    if (kw === 'SET' && !/\bUPDATE\b/i.test(before)) return false;
    if ((kw === 'WHEN' || kw === 'THEN' || kw === 'ELSE' || kw === 'END') && !/\bCASE\b/i.test(before)) {
      return false;
    }
    return true;
  });

  if (inWhere && !isValueContext(before)) {
    const whereOps = new Set(['AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS NULL', 'IS NOT NULL', 'EXISTS', 'NULL']);
    allowed = allowed.filter((kw) => whereOps.has(kw) || kw.startsWith('IS '));
  }

  return allowed;
}

// -1 = no match, 0 = starts-with, 1 = substring. Strips leading quote from partial quoted identifier before matching.
export function matchScore(label: string, lcPrefix: string): number {
  if (!lcPrefix) return 0;
  let needle = lcPrefix;
  if (needle.length > 0) {
    const first = needle[0];
    if (first === '"' || first === "'" || first === '`') needle = needle.slice(1);
  }
  if (!needle) return 0;
  const lc = label.toLowerCase();
  if (lc.startsWith(needle)) return 0;
  if (lc.includes(needle)) return 1;
  return -1;
}

// Tiers: 0=in-query cols/aliases, 1=all tables/cols, 2=context snippets, 3=schemas, 4=keywords, 5=aggregates.
export function rank(tier: 0 | 1 | 2 | 3 | 4 | 5, score: number, label: string): string {
  return `${tier}${score}_${label.toLowerCase()}`;
}

// Column hint shown in the suggestion's detail line: type plus PK / FK / NOT NULL markers.
export function columnDetail(c: ColumnInfo): string {
  const tags: string[] = [];
  if (c.isPrimary) tags.push('PK');
  if (c.isForeign) tags.push('FK');
  if (tags.length > 0) return `${c.dataType} · ${tags.join(' · ')}`;
  if (!c.isNullable) return `${c.dataType} · not null`;
  return c.dataType;
}

// CTE names declared in a leading WITH clause, offered like tables in the FROM/JOIN slot. (We
// don't know a CTE's columns without parsing its body, so only the name is suggested.)
export function suggestCteItems(ctes: string[], lcPrefix: string, driver: DriverType): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  for (const name of ctes) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const score = matchScore(name, lcPrefix);
    if (score < 0) continue;
    seen.add(key);
    items.push({
      label: name,
      kind: 'class',
      detail: 'CTE',
      insertText: formatSqlIdentifier(name, driver),
      filterText: formatSqlIdentifier(name, driver),
      // Tier 0 (query-local): ranks above the table list; callers also list CTEs first so they
      // survive buildCompletionItems' 100-item slice.
      sortText: rank(0, score, name),
    });
  }
  return items;
}

export function suggestTables(ctx: CompletionContext, lcPrefix: string, schemaFilter?: string): CompletionItem[] {
  const items: CompletionItem[] = [];
  const source = schemaFilter
    ? ctx.tablesBySchema[schemaFilter] ||
      ctx.tables.filter((t) => t.schema.toLowerCase() === schemaFilter.toLowerCase())
    : ctx.tables;

  for (const t of source) {
    const score = matchScore(t.name, lcPrefix);
    if (score < 0) continue;
    const insert = formatSqlIdentifier(t.name, ctx.driver);
    items.push({
      label: t.name,
      kind: 'class',
      detail: schemaFilter ? 'table' : t.type || 'table',
      insertText: insert,
      filterText: insert,
      sortText: rank(1, score, t.name),
    });
  }
  return items;
}

export function suggestSchemas(ctx: CompletionContext, lcPrefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const s of ctx.schemas) {
    const score = matchScore(s.name, lcPrefix);
    if (score < 0) continue;
    items.push({
      label: s.name,
      kind: 'module',
      detail: 'schema',
      insertText: formatSqlIdentifier(s.name, ctx.driver),
      sortText: rank(3, score, s.name),
    });
  }
  return items;
}

export function suggestQueryTableRefs(
  ctx: CompletionContext,
  queryTables: QueryTableRef[],
  lcPrefix: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seenTables = new Set<string>();
  const seenAliases = new Set<string>();

  for (const ref of queryTables) {
    const tableKey = ref.table.toLowerCase();
    if (!seenTables.has(tableKey)) {
      const score = matchScore(ref.table, lcPrefix);
      if (score >= 0) {
        seenTables.add(tableKey);
        const insert = formatSqlIdentifier(ref.table, ctx.driver);
        items.push({
          label: ref.table,
          kind: 'class',
          detail: ref.schema ? `${ref.schema} · table` : 'table',
          insertText: insert,
          filterText: insert,
          sortText: rank(0, score, ref.table),
        });
      }
    }

    if (ref.alias) {
      const aliasKey = ref.alias.toLowerCase();
      if (!seenAliases.has(aliasKey)) {
        const score = matchScore(ref.alias, lcPrefix);
        if (score >= 0) {
          seenAliases.add(aliasKey);
          const insert = formatSqlIdentifier(ref.alias, ctx.driver);
          items.push({
            label: ref.alias,
            kind: 'class',
            detail: `alias → ${ref.table}`,
            insertText: insert,
            filterText: insert,
            sortText: rank(0, score, ref.alias),
          });
        }
      }
    }
  }

  return items;
}

export function suggestColumnsFromBindings(
  ctx: CompletionContext,
  bindings: Map<string, TableBinding>,
  lcPrefix: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  const seenTables = new Set<string>();

  for (const binding of bindings.values()) {
    const tk = columnCacheKey(binding.schema, binding.table);
    if (seenTables.has(tk)) continue;
    seenTables.add(tk);
    for (const c of ctx.columnsByTable[tk] || []) {
      const key = c.name.toLowerCase();
      if (seen.has(key)) continue;
      const score = matchScore(c.name, lcPrefix);
      if (score < 0) continue;
      seen.add(key);
      items.push({
        label: c.name,
        kind: 'field',
        detail: columnDetail(c),
        insertText: formatSqlIdentifier(c.name, ctx.driver),
        sortText: rank(0, score, c.name),
      });
    }
  }

  return items;
}

export function suggestValueItems(
  ctx: CompletionContext,
  queryTables: QueryTableRef[],
  bindings: Map<string, TableBinding>,
  lcPrefix: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seenCols = new Set<string>();

  // The compared-to value is often another (qualified) column, so offer the in-scope tables
  // and aliases too - e.g. `ON a.id = "EBayAccounts".userId`. Bare columns follow below.
  items.push(...suggestQueryTableRefs(ctx, queryTables, lcPrefix));

  for (const lit of VALUE_LITERALS) {
    const score = matchScore(lit, lcPrefix);
    if (score < 0) continue;
    items.push({ label: lit, kind: 'keyword', insertText: lit, sortText: rank(4, score, lit) });
  }

  const addColumns = (cols: ColumnInfo[], tier: 0 | 1) => {
    for (const c of cols) {
      const key = c.name.toLowerCase();
      if (seenCols.has(key)) continue;
      const score = matchScore(c.name, lcPrefix);
      if (score < 0) continue;
      seenCols.add(key);
      items.push({
        label: c.name,
        kind: 'field',
        detail: columnDetail(c),
        insertText: formatSqlIdentifier(c.name, ctx.driver),
        sortText: rank(tier, score, c.name),
      });
    }
  };

  for (const binding of bindings.values()) {
    addColumns(ctx.columnsByTable[columnCacheKey(binding.schema, binding.table)] || [], 0);
  }
  addColumns(ctx.columns, 1);

  return items;
}

export function suggestColumnsForTable(
  ctx: CompletionContext,
  binding: TableBinding,
  lcPrefix: string,
): CompletionItem[] {
  const key = columnCacheKey(binding.schema, binding.table);
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

// In the LIMIT/OFFSET tail the only sensible completion is OFFSET - and only once LIMIT already
// has a value and OFFSET isn't present yet. Otherwise (typing the number, or after OFFSET) nothing.
export function suggestLimitOffset(before: string, lcPrefix: string): CompletionItem[] {
  if (!/\bLIMIT\b\s+(?:\d+|ALL\b)/i.test(before)) return [];
  if (/\bOFFSET\b/i.test(before)) return [];
  const score = matchScore('OFFSET', lcPrefix);
  if (score < 0) return [];
  return [{ label: 'OFFSET', kind: 'keyword', insertText: 'OFFSET', sortText: rank(4, score, 'OFFSET') }];
}

// clauseBodyStart caret butts against the keyword; without a space `email` inserts as `WHEREemail`.
function withLeadingSpace(items: CompletionItem[]): CompletionItem[] {
  return items.map((item) => ({ ...item, insertText: ` ${item.insertText}` }));
}

export function suggestClauseBody(
  ctx: CompletionContext,
  kind: ClauseBodyKind,
  queryTables: QueryTableRef[],
  bindings: Map<string, TableBinding>,
  ctes: string[] = [],
): CompletionItem[] {
  if (kind === 'table') {
    // CTEs first so they aren't dropped by the 100-item slice when the schema has many tables.
    return withLeadingSpace([
      ...suggestCteItems(ctes, '', ctx.driver),
      ...suggestTables(ctx, ''),
      ...suggestSchemas(ctx, ''),
    ]);
  }
  if (kind === 'set') {
    return withLeadingSpace(suggestColumnsFromBindings(ctx, bindings, ''));
  }

  return withLeadingSpace([
    ...suggestQueryTableRefs(ctx, queryTables, ''),
    ...suggestColumnsFromBindings(ctx, bindings, ''),
  ]);
}
