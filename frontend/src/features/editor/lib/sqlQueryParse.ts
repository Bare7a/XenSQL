import { ALIAS_STOP_WORDS, unquoteIdent } from '@/features/editor/lib/sqlQuoting';
import type { DriverType, SchemaInfo, TableInfo } from '@/types';

// IDENT_SRC: quoted (double/single/backtick) or bare identifier.
const IDENT_SRC = '(?:"[^"]+")|(?:\'[^\']+\')|(?:`[^`]+`)|(?:[a-zA-Z_][\\w]*)';

// Bare alias must not be a reserved keyword - otherwise `FROM accounts JOIN contracts` swallows JOIN as accounts' alias. Quoted aliases are always allowed.
const ALIAS_SRC = `(?:"[^"]+")|(?:'[^']+')|(?:\`[^\`]+\`)|(?:(?!(?:${[...ALIAS_STOP_WORDS].join('|')})\\b)[a-zA-Z_][\\w]*)`;

const TABLE_BINDING_RE = new RegExp(
  `\\b(?:FROM|JOIN)\\s+(${IDENT_SRC})(?:\\s*\\.\\s*(${IDENT_SRC}))?(?:\\s+(?:AS\\s+)?(${ALIAS_SRC}))?`,
  'gi',
);

const UPDATE_BINDING_RE =
  /\bUPDATE\s+((?:"[^"]+")|(?:'[^']+')|(?:`[^`]+`)|(?:[a-zA-Z_][\w]*))(?:\s*\.\s*((?:"[^"]+")|(?:'[^']+')|(?:`[^`]+`)|(?:[a-zA-Z_][\w]*)))?/gi;

// Comma-separated FROM tables (`FROM a, b c, schema.d`): FROM_TABLE_LIST_RE captures the whole
// list, FROM_ITEM_RE walks each `table[.table] [alias]`. The ALIAS stop-word guard stops
// `FROM a JOIN b` reading JOIN as a's alias.
const FROM_ITEM_SRC = `(?:${IDENT_SRC})(?:\\s*\\.\\s*(?:${IDENT_SRC}))?(?:\\s+(?:AS\\s+)?(?:${ALIAS_SRC}))?`;
const FROM_TABLE_LIST_RE = new RegExp(`\\bFROM\\s+(${FROM_ITEM_SRC}(?:\\s*,\\s*${FROM_ITEM_SRC})*)`, 'gi');
const FROM_ITEM_RE = new RegExp(`(${IDENT_SRC})(?:\\s*\\.\\s*(${IDENT_SRC}))?(?:\\s+(?:AS\\s+)?(${ALIAS_SRC}))?`, 'gi');

// CTE names declared in a leading WITH clause: `WITH a AS (…), b (c1,c2) AS (…)`. The `AS (`
// shape is CTE-specific (column aliases use `AS name` with no paren), so false positives are rare.
const CTE_NAME_RE = new RegExp(
  `(?:\\bWITH\\b|,)\\s*(?:RECURSIVE\\s+)?(${IDENT_SRC})\\s*(?:\\([^)]*\\))?\\s+AS\\s+(?:NOT\\s+MATERIALIZED\\s+|MATERIALIZED\\s+)?\\(`,
  'gi',
);

export interface TableBinding {
  schema: string;
  table: string;
}

export interface QueryTableRef {
  schema: string;
  table: string;
  alias?: string;
  index: number; // source offset of the FROM/JOIN keyword
}

export interface ParsedQuery {
  queryTables: QueryTableRef[];
  bindings: Map<string, TableBinding>;
  ctes: string[]; // CTE names from a leading WITH clause (offered like tables in FROM/JOIN)
}

export function resolveTableName(
  tableName: string,
  schemaHint: string | undefined,
  tables: TableInfo[],
  schemas: SchemaInfo[],
  driver: DriverType,
): TableBinding {
  const lcName = tableName.toLowerCase();
  const lcHint = schemaHint?.toLowerCase();
  const match =
    tables.find((t) => t.name.toLowerCase() === lcName && (!lcHint || t.schema.toLowerCase() === lcHint)) ||
    tables.find((t) => t.name.toLowerCase() === lcName);
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

export function parseTableRef(
  part1: string,
  part2: string | undefined,
  tables: TableInfo[],
  schemas: SchemaInfo[],
  driver: DriverType,
): TableBinding {
  if (part2) {
    return resolveTableName(unquoteIdent(part2), unquoteIdent(part1), tables, schemas, driver);
  }
  return resolveTableName(unquoteIdent(part1), undefined, tables, schemas, driver);
}

export function parseQueryContext(
  sql: string,
  tables: TableInfo[],
  schemas: SchemaInfo[],
  driver: DriverType,
): ParsedQuery {
  const queryTables: QueryTableRef[] = [];

  TABLE_BINDING_RE.lastIndex = 0;
  for (let m = TABLE_BINDING_RE.exec(sql); m !== null; m = TABLE_BINDING_RE.exec(sql)) {
    if (!m[1]) continue;
    const binding = parseTableRef(m[1], m[2], tables, schemas, driver);
    const aliasRaw = m[3];
    // Strip quotes before ALIAS_STOP_WORDS check so quoted keywords like "WHERE" are still filtered.
    const aliasUnquoted = aliasRaw ? unquoteIdent(aliasRaw) : undefined;
    const alias = aliasUnquoted && !ALIAS_STOP_WORDS.has(aliasUnquoted.toLowerCase()) ? aliasUnquoted : undefined;
    queryTables.push({ schema: binding.schema, table: binding.table, alias, index: m.index });
  }

  UPDATE_BINDING_RE.lastIndex = 0;
  for (let m = UPDATE_BINDING_RE.exec(sql); m !== null; m = UPDATE_BINDING_RE.exec(sql)) {
    if (!m[1]) continue;
    const binding = parseTableRef(m[1], m[2], tables, schemas, driver);
    queryTables.push({ schema: binding.schema, table: binding.table, index: m.index });
  }

  // Comma-joined FROM tables (`FROM a, b, c`) - TABLE_BINDING_RE only caught the first; dedup below
  // drops the resulting overlap on that first table.
  FROM_TABLE_LIST_RE.lastIndex = 0;
  for (let m = FROM_TABLE_LIST_RE.exec(sql); m !== null; m = FROM_TABLE_LIST_RE.exec(sql)) {
    const list = m[1];
    const listIndex = m.index;
    FROM_ITEM_RE.lastIndex = 0;
    for (let im = FROM_ITEM_RE.exec(list); im !== null; im = FROM_ITEM_RE.exec(list)) {
      if (!im[1]) continue;
      const binding = parseTableRef(im[1], im[2], tables, schemas, driver);
      const aliasRaw = im[3];
      const aliasUnquoted = aliasRaw ? unquoteIdent(aliasRaw) : undefined;
      const alias = aliasUnquoted && !ALIAS_STOP_WORDS.has(aliasUnquoted.toLowerCase()) ? aliasUnquoted : undefined;
      queryTables.push({ schema: binding.schema, table: binding.table, alias, index: listIndex });
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

  const ctes: string[] = [];
  if (/^\s*WITH\b/i.test(sql)) {
    CTE_NAME_RE.lastIndex = 0;
    for (let m = CTE_NAME_RE.exec(sql); m !== null; m = CTE_NAME_RE.exec(sql)) {
      if (m[1]) ctes.push(unquoteIdent(m[1]));
    }
  }

  return { queryTables: deduped, bindings, ctes };
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
  if (tables.some((t) => t.schema.toLowerCase() === key)) return null;

  const fromAlias = bindings.get(key);
  if (fromAlias) return fromAlias;

  const asTable = resolveTableName(qualifier, undefined, tables, schemas, driver);
  return asTable;
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
