import { cacheKey, LruCache } from '@/features/editor/lib/sqlCache';
import { ALIAS_STOP_WORDS, unquoteIdent } from '@/features/editor/lib/sqlQuoting';
import {
  isIdentLike,
  isKeyword,
  nextCodeToken,
  prevCodeToken,
  type SqlToken,
  tokenIdentText,
  tokenizeSql,
} from '@/features/editor/lib/sqlTokens';
import type { DriverType, SchemaInfo, TableInfo } from '@/types';

export interface TableBinding {
  schema: string;
  table: string;
}

export interface QueryTableRef {
  schema: string;
  table: string;
  alias?: string;
  index: number; // source offset of the FROM/JOIN/UPDATE/INSERT keyword
  nameStart: number; // source span of the table-name token (for diagnostics/hover)
  nameEnd: number;
  known: boolean; // resolved against the live schema (false = best-effort guess, maybe a typo)
}

export interface ParsedQuery {
  queryTables: QueryTableRef[];
  bindings: Map<string, TableBinding>;
  ctes: string[]; // CTE names from a leading WITH clause (offered like tables in FROM/JOIN)
  // Projected column names of query-local relations that have no schema entry (CTEs and
  // derived-table aliases). Lowercased keys; empty when the projection is opaque (SELECT *).
  virtualColumns: Map<string, string[]>;
}

// Lowercase name/schema lookups, cached per tables-array identity (hit several times per keystroke).
interface TableIndex {
  byName: Map<string, TableInfo[]>;
  schemaNames: Set<string>;
}

const tableIndexCache = new WeakMap<TableInfo[], TableIndex>();

function tableIndexFor(tables: TableInfo[]): TableIndex {
  let index = tableIndexCache.get(tables);
  if (!index) {
    const byName = new Map<string, TableInfo[]>();
    const schemaNames = new Set<string>();
    for (const t of tables) {
      const key = t.name.toLowerCase();
      const list = byName.get(key);
      if (list) {
        list.push(t);
      } else {
        byName.set(key, [t]);
      }
      schemaNames.add(t.schema.toLowerCase());
    }
    index = { byName, schemaNames };
    tableIndexCache.set(tables, index);
  }
  return index;
}

function lookupTable(tableName: string, schemaHint: string | undefined, tables: TableInfo[]): TableInfo | undefined {
  const lcHint = schemaHint?.toLowerCase();
  const candidates = tableIndexFor(tables).byName.get(tableName.toLowerCase());
  return (lcHint && candidates?.find((t) => t.schema.toLowerCase() === lcHint)) || candidates?.[0];
}

function resolveTableName(
  tableName: string,
  schemaHint: string | undefined,
  tables: TableInfo[],
  schemas: SchemaInfo[],
  driver: DriverType,
): TableBinding {
  const match = lookupTable(tableName, schemaHint, tables);
  let schema = schemaHint || match?.schema || '';
  if (!schema) {
    if (driver === 'postgres') {
      schema = schemas.find((s) => s.name === 'public')?.name || schemas[0]?.name || 'public';
    } else {
      schema = schemas[0]?.name || '';
    }
  }
  return { schema, table: match?.name ?? tableName };
}

const isDot = (t: SqlToken | undefined) => t !== undefined && t.kind === 'punct' && t.text === '.';
const isComma = (t: SqlToken | undefined) => t !== undefined && t.kind === 'punct' && t.text === ',';

interface RawRef {
  name1: SqlToken;
  name2?: SqlToken;
  alias?: SqlToken;
  last: number; // index of the ref's final consumed token
}

// `name[.name] [AS] [alias]`; bare aliases must not be reserved words (JOIN after FROM is no alias).
function readTableRef(tokens: SqlToken[], at: number, allowAlias: boolean): RawRef | null {
  if (!isIdentLike(tokens[at])) return null;
  const name1 = tokens[at];
  let last = at;
  let name2: SqlToken | undefined;
  let j = nextCodeToken(tokens, last);
  if (j !== -1 && isDot(tokens[j])) {
    const k = nextCodeToken(tokens, j);
    if (k === -1 || !isIdentLike(tokens[k])) {
      return { name1, last }; // dangling `schema.` while typing - bind the first part only
    }
    name2 = tokens[k];
    last = k;
    j = nextCodeToken(tokens, last);
  }
  let alias: SqlToken | undefined;
  if (allowAlias && j !== -1) {
    const t = tokens[j];
    if (isKeyword(t, 'as')) {
      const k = nextCodeToken(tokens, j);
      if (k !== -1 && isIdentLike(tokens[k])) {
        alias = tokens[k];
        last = k;
      }
    } else if (isIdentLike(t) && (t.kind === 'quoted' || !ALIAS_STOP_WORDS.has(t.lower))) {
      alias = t;
      last = j;
    }
  }
  return { name1, name2, alias, last };
}

// Index of the `)` matching the `(` at openIdx, or -1 when unbalanced.
function matchParen(tokens: SqlToken[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'punct') continue;
    if (t.text === '(') depth++;
    else if (t.text === ')' && --depth === 0) return i;
  }
  return -1;
}

// Projected column names of the SELECT in tokens[start, end); unaliased expressions and `*` contribute nothing.
function extractProjection(tokens: SqlToken[], start: number, end: number): string[] {
  const cols: string[] = [];
  let i = start;
  let depth = 0;
  for (; i < end; i++) {
    const t = tokens[i];
    if (t.kind === 'punct') {
      if (t.text === '(') depth++;
      else if (t.text === ')') depth--;
    } else if (depth === 0 && isKeyword(t, 'select')) {
      break;
    }
  }
  if (i >= end) return cols;
  i = nextCodeToken(tokens, i);
  if (i !== -1 && (isKeyword(tokens[i], 'distinct') || isKeyword(tokens[i], 'all'))) i = nextCodeToken(tokens, i);
  if (i === -1) return cols;

  let item: SqlToken[] = [];
  const flush = () => {
    const last = item[item.length - 1];
    if (last && (last.kind === 'ident' || last.kind === 'quoted')) {
      const prev = item[item.length - 2];
      const aliased =
        prev !== undefined &&
        (prev.kind === 'ident' || prev.kind === 'quoted' || prev.kind === 'number' || isPunctToken(prev, ')'));
      if (item.length === 1 || isPunctToken(prev, '.') || aliased) {
        if (!isKeyword(last, 'as')) cols.push(tokenIdentText(last));
      }
    }
    item = [];
  };

  let inner = 0;
  for (; i < end; i++) {
    const t = tokens[i];
    if (t.kind === 'comment') continue;
    if (t.kind === 'punct') {
      if (t.text === '(') inner++;
      else if (t.text === ')') {
        if (inner === 0) break;
        inner--;
      } else if (t.text === ',' && inner === 0) {
        flush();
        continue;
      }
    }
    if (inner === 0 && t.kind === 'ident' && t.lower === 'from') break;
    item.push(t);
  }
  flush();
  return cols;
}

const isPunctToken = (t: SqlToken | undefined, ch: string) => t !== undefined && t.kind === 'punct' && t.text === ch;

// CTE names + projections from a leading WITH; bodies skip balanced (inner refs come from the main pass).
function collectCtes(tokens: SqlToken[], virtualColumns: Map<string, string[]>): string[] {
  const ctes: string[] = [];
  let i = nextCodeToken(tokens, -1);
  if (i === -1 || !isKeyword(tokens[i], 'with')) return ctes;
  i = nextCodeToken(tokens, i);
  if (i !== -1 && isKeyword(tokens[i], 'recursive')) i = nextCodeToken(tokens, i);

  while (i !== -1 && isIdentLike(tokens[i])) {
    const name = tokens[i];
    let explicitCols: string[] | null = null;
    let j = nextCodeToken(tokens, i);
    if (j !== -1 && isPunctToken(tokens[j], '(')) {
      const close = matchParen(tokens, j);
      if (close === -1) break;
      explicitCols = [];
      for (let k = j + 1; k < close; k++) {
        if (isIdentLike(tokens[k])) explicitCols.push(tokenIdentText(tokens[k]));
      }
      j = nextCodeToken(tokens, close);
    }
    if (j === -1 || !isKeyword(tokens[j], 'as')) break;
    j = nextCodeToken(tokens, j);
    if (j !== -1 && isKeyword(tokens[j], 'not')) j = nextCodeToken(tokens, j);
    if (j !== -1 && isKeyword(tokens[j], 'materialized')) j = nextCodeToken(tokens, j);
    if (j === -1 || !isPunctToken(tokens[j], '(')) break;
    ctes.push(tokenIdentText(name)); // `AS (` seen - the body may still be unterminated while typing
    const close = matchParen(tokens, j);
    const bodyEnd = close === -1 ? tokens.length : close;
    virtualColumns.set(tokenIdentText(name).toLowerCase(), explicitCols ?? extractProjection(tokens, j + 1, bodyEnd));
    if (close === -1) break;
    const comma = nextCodeToken(tokens, close);
    if (comma === -1 || !isComma(tokens[comma])) break;
    i = nextCodeToken(tokens, comma);
  }
  return ctes;
}

// Completion, hover and diagnostics each parse the current statement per keystroke; diagnostics
// re-parse every statement in the buffer, so unchanged statements should be cache hits. The
// schema arrays participate in resolution, so a hit also requires their identity to match.
interface ParseCacheEntry {
  tables: TableInfo[];
  schemas: SchemaInfo[];
  result: ParsedQuery;
}

// Capacity must exceed the statement count of a typical buffer (diagnostics parse every
// statement per pass); beyond it the cache degrades gracefully to recomputing.
const parseCache = new LruCache<ParseCacheEntry>(256);

export function parseQueryContext(
  sql: string,
  tables: TableInfo[],
  schemas: SchemaInfo[],
  driver: DriverType,
): ParsedQuery {
  const key = cacheKey(driver, sql);
  const hit = parseCache.get(key);
  if (hit && hit.tables === tables && hit.schemas === schemas) return hit.result;
  const result = parseQuery(sql, tables, schemas, driver);
  parseCache.set(key, { tables, schemas, result });
  return result;
}

function parseQuery(sql: string, tables: TableInfo[], schemas: SchemaInfo[], driver: DriverType): ParsedQuery {
  const tokens = tokenizeSql(sql, driver);
  const queryTables: QueryTableRef[] = [];
  const virtualColumns = new Map<string, string[]>();

  const pushRef = (kwOffset: number, raw: RawRef) => {
    const nameTok = raw.name2 ?? raw.name1;
    const name = tokenIdentText(nameTok);
    const schemaHint = raw.name2 ? tokenIdentText(raw.name1) : undefined;
    const binding = resolveTableName(name, schemaHint, tables, schemas, driver);
    const aliasText = raw.alias ? tokenIdentText(raw.alias) : undefined;
    const alias = aliasText && !ALIAS_STOP_WORDS.has(aliasText.toLowerCase()) ? aliasText : undefined;
    // A lone name that matches a schema is a qualifier still being typed (`FROM public.`), not a typo.
    const known =
      lookupTable(name, schemaHint, tables) !== undefined ||
      (!raw.name2 && tableIndexFor(tables).schemaNames.has(name.toLowerCase()));
    queryTables.push({
      schema: binding.schema,
      table: binding.table,
      alias,
      index: kwOffset,
      nameStart: nameTok.start,
      nameEnd: nameTok.end,
      known,
    });
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'ident') continue;

    if (t.lower === 'from' || t.lower === 'join') {
      // The FROM of `IS [NOT] DISTINCT FROM` is a comparison operator, not a table source.
      const p = prevCodeToken(tokens, i);
      if (t.lower === 'from' && p !== -1 && isKeyword(tokens[p], 'distinct')) continue;
      // FROM takes a comma list; JOIN a single ref.
      let at = nextCodeToken(tokens, i);
      for (;;) {
        if (at !== -1 && isPunctToken(tokens[at], '(')) {
          // Derived table `(SELECT …) alias`: record its alias + projection. The main loop still
          // descends into the body and collects its inner FROM/JOIN refs.
          const close = matchParen(tokens, at);
          if (close === -1) break;
          let aliasIdx = nextCodeToken(tokens, close);
          if (aliasIdx !== -1 && isKeyword(tokens[aliasIdx], 'as')) aliasIdx = nextCodeToken(tokens, aliasIdx);
          const aliasTok = aliasIdx !== -1 ? tokens[aliasIdx] : undefined;
          const aliasOk =
            aliasTok !== undefined &&
            (aliasTok.kind === 'quoted' || (aliasTok.kind === 'ident' && !ALIAS_STOP_WORDS.has(aliasTok.lower)));
          if (!aliasOk) break;
          virtualColumns.set(tokenIdentText(aliasTok).toLowerCase(), extractProjection(tokens, at + 1, close));
          if (t.lower === 'join') break;
          const comma = nextCodeToken(tokens, aliasIdx);
          if (comma === -1 || !isComma(tokens[comma])) break;
          at = nextCodeToken(tokens, comma);
          continue;
        }
        const raw = at !== -1 ? readTableRef(tokens, at, true) : null;
        if (!raw) break;
        pushRef(t.start, raw);
        if (t.lower === 'join') break;
        const comma = nextCodeToken(tokens, raw.last);
        if (comma === -1 || !isComma(tokens[comma])) break;
        at = nextCodeToken(tokens, comma);
      }
    } else if (t.lower === 'update') {
      const at = nextCodeToken(tokens, i);
      const raw = at !== -1 ? readTableRef(tokens, at, true) : null;
      if (raw) pushRef(t.start, raw);
    } else if (t.lower === 'into') {
      const p = prevCodeToken(tokens, i);
      if (p !== -1 && (isKeyword(tokens[p], 'insert') || isKeyword(tokens[p], 'replace'))) {
        const at = nextCodeToken(tokens, i);
        const raw = at !== -1 ? readTableRef(tokens, at, false) : null;
        if (raw) pushRef(tokens[p].start, raw);
      }
    }
  }

  const deduped: QueryTableRef[] = [];
  const seenRefs = new Set<string>();
  for (const ref of queryTables) {
    const key = `${ref.schema}|${ref.table}|${ref.alias ?? ''}`.toLowerCase();
    if (seenRefs.has(key)) continue;
    seenRefs.add(key);
    deduped.push(ref);
  }

  const bindings = new Map<string, TableBinding>();
  for (const ref of deduped) {
    bindings.set(ref.table.toLowerCase(), { schema: ref.schema, table: ref.table });
    if (ref.alias) {
      bindings.set(ref.alias.toLowerCase(), { schema: ref.schema, table: ref.table });
    }
  }

  return { queryTables: deduped, bindings, ctes: collectCtes(tokens, virtualColumns), virtualColumns };
}

export function resolveQualifierToTable(
  qualifier: string,
  bindings: Map<string, TableBinding>,
  tables: TableInfo[],
  schemas: SchemaInfo[],
  driver: DriverType,
): TableBinding | null {
  const key = qualifier.toLowerCase();
  // A schema qualifier (e.g. `analytics.`) must fall through to "list that schema's tables" - not
  // resolve to a same-named alias/table binding - so check schema membership first.
  if (tableIndexFor(tables).schemaNames.has(key)) return null;

  const fromAlias = bindings.get(key);
  if (fromAlias) return fromAlias;

  return resolveTableName(qualifier, undefined, tables, schemas, driver);
}

export function resolveDotCompletion(
  dot: { segments: string[] },
  bindings: Map<string, TableBinding>,
  tables: TableInfo[],
  schemas: SchemaInfo[],
  driver: DriverType,
): TableBinding | null {
  if (dot.segments.length === 2) {
    return resolveTableName(unquoteIdent(dot.segments[1]), unquoteIdent(dot.segments[0]), tables, schemas, driver);
  }
  return resolveQualifierToTable(unquoteIdent(dot.segments[0]), bindings, tables, schemas, driver);
}
