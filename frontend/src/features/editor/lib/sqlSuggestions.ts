import type { StatementShape } from '@/features/editor/lib/sqlContext';
import type { QueryTableRef, TableBinding } from '@/features/editor/lib/sqlQueryParse';
import { columnCacheKey, formatSqlIdentifier } from '@/features/editor/lib/sqlQuoting';
import { t } from '@/i18n';
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

// One rule per keyword: shape gate, engines and whether it survives inside WHERE.
interface KeywordRule {
  kw: string;
  drivers?: readonly DriverType[];
  whereOk?: boolean;
  gate?: (s: StatementShape) => boolean;
}

const atStart = (s: StatementShape) => s.atStatementStart;
const joinable = (s: StatementShape) => s.joinable;
const inFilterClause = (s: StatementShape) => s.inFilterClause;

const KEYWORD_RULES: readonly KeywordRule[] = [
  // Statement starters.
  { kw: 'SELECT', gate: atStart },
  { kw: 'INSERT INTO', gate: atStart },
  { kw: 'UPDATE', gate: atStart },
  { kw: 'DELETE', gate: atStart },
  { kw: 'CREATE TABLE', gate: atStart },
  { kw: 'ALTER TABLE', gate: atStart },
  { kw: 'DROP TABLE', gate: atStart },
  { kw: 'EXPLAIN', gate: atStart },
  { kw: 'TRUNCATE TABLE', drivers: ['postgres', 'mysql'], gate: atStart },
  { kw: 'REPLACE INTO', drivers: ['mysql', 'sqlite'], gate: atStart },
  { kw: 'VACUUM', drivers: ['postgres', 'sqlite'], gate: atStart },
  { kw: 'PRAGMA', drivers: ['sqlite'], gate: atStart },
  { kw: 'SHOW TABLES', drivers: ['mysql'], gate: atStart },
  { kw: 'SHOW DATABASES', drivers: ['mysql'], gate: atStart },

  // Clause structure.
  { kw: 'FROM', gate: (s) => !s.hasFrom },
  { kw: 'WHERE', gate: (s) => !s.inWhere },
  { kw: 'JOIN', gate: joinable },
  { kw: 'LEFT JOIN', gate: joinable },
  { kw: 'RIGHT JOIN', gate: joinable },
  { kw: 'INNER JOIN', gate: joinable },
  { kw: 'CROSS JOIN', gate: joinable },
  { kw: 'FULL JOIN', drivers: ['postgres', 'sqlite'], gate: joinable },
  { kw: 'ON', gate: (s) => s.hasJoin },
  { kw: 'GROUP BY', whereOk: true, gate: (s) => s.hasFrom && !s.groupBySeen },
  { kw: 'ORDER BY', whereOk: true, gate: (s) => s.hasFrom && !s.orderBySeen },
  { kw: 'HAVING', gate: (s) => s.groupBySeen },
  { kw: 'LIMIT', whereOk: true },
  { kw: 'OFFSET', whereOk: true },
  { kw: 'VALUES', gate: (s) => s.hasInsert },
  { kw: 'SET', gate: (s) => s.hasUpdate },
  { kw: 'UNION' },
  { kw: 'UNION ALL' },

  // Expression keywords.
  { kw: 'AND', whereOk: true },
  { kw: 'OR', whereOk: true },
  { kw: 'NOT', whereOk: true },
  { kw: 'IN', whereOk: true },
  { kw: 'LIKE', whereOk: true },
  { kw: 'BETWEEN', whereOk: true },
  { kw: 'IS NULL', whereOk: true },
  { kw: 'IS NOT NULL', whereOk: true },
  { kw: 'EXISTS', whereOk: true },
  { kw: 'NULL', whereOk: true },
  { kw: 'AS' },
  { kw: 'DISTINCT' },
  { kw: 'CAST' },
  { kw: 'CASE' },
  { kw: 'WHEN', gate: (s) => s.hasCase },
  { kw: 'THEN', gate: (s) => s.hasCase },
  { kw: 'ELSE', gate: (s) => s.hasCase },
  { kw: 'END', gate: (s) => s.hasCase },

  // Filter/pattern operators; the dialect ones only exist (or only behave sanely) on their engine.
  { kw: 'NOT LIKE', whereOk: true, gate: inFilterClause },
  { kw: 'NOT IN', whereOk: true, gate: inFilterClause },
  { kw: 'NOT BETWEEN', whereOk: true, gate: inFilterClause },
  { kw: 'ILIKE', drivers: ['postgres'], whereOk: true, gate: inFilterClause },
  { kw: 'NOT ILIKE', drivers: ['postgres'], whereOk: true, gate: inFilterClause },
  { kw: 'SIMILAR TO', drivers: ['postgres'], whereOk: true, gate: inFilterClause },
  { kw: 'IS DISTINCT FROM', drivers: ['postgres'], whereOk: true, gate: inFilterClause },
  { kw: 'IS NOT DISTINCT FROM', drivers: ['postgres'], whereOk: true, gate: inFilterClause },
  { kw: 'REGEXP', drivers: ['mysql'], whereOk: true, gate: inFilterClause },
  { kw: 'RLIKE', drivers: ['mysql'], whereOk: true, gate: inFilterClause },
  { kw: 'GLOB', drivers: ['sqlite'], whereOk: true, gate: inFilterClause },
  { kw: 'MATCH', drivers: ['sqlite'], whereOk: true, gate: inFilterClause },

  // Write-statement tails.
  { kw: 'RETURNING', drivers: ['postgres', 'sqlite'], whereOk: true, gate: (s) => s.returningSlot },
  { kw: 'ON CONFLICT', drivers: ['postgres', 'sqlite'], whereOk: true, gate: (s) => s.insertBody },
  { kw: 'ON DUPLICATE KEY UPDATE', drivers: ['mysql'], whereOk: true, gate: (s) => s.insertBody },
];

export function keywordsForShape(shape: StatementShape, driver?: DriverType): string[] {
  const out: string[] = [];
  for (const r of KEYWORD_RULES) {
    if (r.drivers && (!driver || !r.drivers.includes(driver))) continue;
    if (shape.inWhere && !r.whereOk) continue;
    if (r.gate && !r.gate(shape)) continue;
    out.push(r.kw);
  }
  return out;
}

// -1 = no match, 0 = starts-with, 1 = substring. Strips leading quote from partial quoted identifier before matching.
export function matchScore(label: string, lcPrefix: string): number {
  if (!lcPrefix) return 0;
  let needle = lcPrefix;
  const first = needle[0];
  if (first === '"' || first === "'" || first === '`') needle = needle.slice(1);
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
  if (c.isPrimary) tags.push(t('editor.sql.pk'));
  if (c.isForeign) tags.push(t('editor.sql.fk'));
  if (tags.length > 0) return `${c.dataType} · ${tags.join(' · ')}`;
  if (!c.isNullable) return `${c.dataType} · ${t('editor.sql.notNull')}`;
  return c.dataType;
}

// Known relation kinds; unknown catalog values pass through.
export function relationTypeLabel(type?: string): string {
  const raw = (type || 'table').trim();
  const key = raw.toLowerCase();
  if (key === 'table' || key === 'base table') return t('editor.sql.table');
  if (key === 'view') return t('editor.sql.view');
  return raw;
}

export function keywordItem(kw: string, lcPrefix: string): CompletionItem | null {
  const score = matchScore(kw, lcPrefix);
  if (score < 0) return null;
  return { label: kw, kind: 'keyword', insertText: kw, sortText: rank(4, score, kw) };
}

function pushColumnItems(
  items: CompletionItem[],
  cols: ColumnInfo[],
  tier: 0 | 1,
  lcPrefix: string,
  driver: DriverType,
  seen?: Set<string>,
): void {
  for (const c of cols) {
    const key = c.name.toLowerCase();
    if (seen?.has(key)) continue;
    const score = matchScore(c.name, lcPrefix);
    if (score < 0) continue;
    seen?.add(key);
    items.push({
      label: c.name,
      kind: 'field',
      detail: columnDetail(c),
      insertText: formatSqlIdentifier(c.name, driver),
      sortText: rank(tier, score, c.name),
    });
  }
}

// Projected columns of a CTE or derived-table alias - names only, no schema types to show.
export function suggestVirtualColumns(
  names: string[],
  lcPrefix: string,
  driver: DriverType,
  detail: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const score = matchScore(name, lcPrefix);
    if (score < 0) continue;
    seen.add(key);
    items.push({
      label: name,
      kind: 'field',
      detail,
      insertText: formatSqlIdentifier(name, driver),
      sortText: rank(0, score, name),
    });
  }
  return items;
}

// CTE names declared in a leading WITH clause, offered like tables in the FROM/JOIN slot.
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
      detail: t('editor.sql.cte'),
      insertText: formatSqlIdentifier(name, driver),
      filterText: formatSqlIdentifier(name, driver),
      // Tier 0 (query-local): ranks above the table list so it survives the 100-item cap.
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
    const kind = relationTypeLabel(schemaFilter ? 'table' : t.type || 'table');
    items.push({
      label: t.name,
      kind: 'class',
      detail: kind,
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
      detail: t('editor.sql.schema'),
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
          detail: ref.schema
            ? t('editor.sql.schemaTable', { schema: ref.schema, type: t('editor.sql.table') })
            : t('editor.sql.table'),
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
            detail: t('editor.sql.aliasArrow', { table: ref.table }),
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

// In-scope columns; names shared by multiple sources are offered as `alias.col`.
export function suggestColumnsInScope(
  ctx: CompletionContext,
  queryTables: QueryTableRef[],
  lcPrefix: string,
  seen?: Set<string>,
): CompletionItem[] {
  const sources: { ref: QueryTableRef; cols: ColumnInfo[] }[] = [];
  const seenRefs = new Set<string>();
  for (const ref of queryTables) {
    const refKey = `${columnCacheKey(ref.schema, ref.table)}|${(ref.alias ?? '').toLowerCase()}`;
    if (seenRefs.has(refKey)) continue;
    seenRefs.add(refKey);
    sources.push({ ref, cols: ctx.columnsByTable[columnCacheKey(ref.schema, ref.table)] || [] });
  }

  // Count per source (self-joins: one per alias).
  const nameCount = new Map<string, number>();
  for (const s of sources) {
    for (const name of new Set(s.cols.map((c) => c.name.toLowerCase()))) {
      nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
    }
  }

  const items: CompletionItem[] = [];
  for (const s of sources) {
    const emitted = new Set<string>();
    for (const c of s.cols) {
      const key = c.name.toLowerCase();
      if (emitted.has(key)) continue;
      emitted.add(key);
      const score = matchScore(c.name, lcPrefix);
      if (score < 0) continue;
      if ((nameCount.get(key) ?? 0) > 1) {
        const qualifier = s.ref.alias ?? s.ref.table;
        const label = `${qualifier}.${c.name}`;
        seen?.add(key);
        items.push({
          label,
          kind: 'field',
          detail: columnDetail(c),
          insertText: `${formatSqlIdentifier(qualifier, ctx.driver)}.${formatSqlIdentifier(c.name, ctx.driver)}`,
          sortText: rank(0, score, label),
        });
      } else {
        if (seen?.has(key)) continue;
        seen?.add(key);
        items.push({
          label: c.name,
          kind: 'field',
          detail: columnDetail(c),
          insertText: formatSqlIdentifier(c.name, ctx.driver),
          sortText: rank(0, score, c.name),
        });
      }
    }
  }
  return items;
}

const VALUE_LITERALS = ['NULL', 'TRUE', 'FALSE', 'DEFAULT'];

export function suggestValueItems(ctx: CompletionContext, queryTables: QueryTableRef[], lcPrefix: string): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seenCols = new Set<string>();

  // The compared-to value is often another (qualified) column, so offer the in-scope tables
  // and aliases too - e.g. `ON a.id = "EBayAccounts".userId`. Bare columns follow below.
  items.push(...suggestQueryTableRefs(ctx, queryTables, lcPrefix));

  for (const lit of VALUE_LITERALS) {
    // SQLite has no DEFAULT expression (`SET x = DEFAULT` doesn't parse there).
    if (lit === 'DEFAULT' && ctx.driver === 'sqlite') continue;
    const item = keywordItem(lit, lcPrefix);
    if (item) items.push(item);
  }

  items.push(...suggestColumnsInScope(ctx, queryTables, lcPrefix, seenCols));
  pushColumnItems(items, ctx.columns, 1, lcPrefix, ctx.driver, seenCols);

  return items;
}

export function suggestColumnsForTable(
  ctx: CompletionContext,
  binding: TableBinding,
  lcPrefix: string,
): CompletionItem[] {
  const key = columnCacheKey(binding.schema, binding.table);
  const items: CompletionItem[] = [];
  pushColumnItems(items, ctx.columnsByTable[key] || ctx.columns, 0, lcPrefix, ctx.driver);
  return items;
}

// Clause-start caret butts against the keyword; without a space `email` inserts as `WHEREemail`.
export function withLeadingSpace(items: CompletionItem[]): CompletionItem[] {
  return items.map((item) => ({ ...item, insertText: ` ${item.insertText}` }));
}
