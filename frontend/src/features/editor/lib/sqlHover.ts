import { type ParsedQuery, resolveDotCompletion, type TableBinding } from '@/features/editor/lib/sqlQueryParse';
import { QUOTE_FORCING_KEYWORDS, unquoteIdent } from '@/features/editor/lib/sqlQuoting';
import { columnDetail, relationTypeLabel } from '@/features/editor/lib/sqlSuggestions';
import { isIdentLike, type SqlToken, tokenIdentText, tokenizeSql } from '@/features/editor/lib/sqlTokens';
import { t } from '@/i18n';
import type { ColumnInfo, DriverType, SchemaInfo, TableInfo } from '@/types';

// Immediate answer (`lines`) or a column lookup the caller resolves via cached loads.
export interface HoverQuery {
  start: number; // statement-relative span of the hovered token
  end: number;
  lines?: string[];
  columnLookup?: { bindings: TableBinding[]; name: string };
  // Table/alias hover: the caller appends this relation's column list (loaded lazily).
  tableColumns?: TableBinding;
}

export function columnHoverLines(col: ColumnInfo, table: TableBinding): string[] {
  const where = table.schema ? `${table.schema}.${table.table}` : table.table;
  return [`**${col.name}** · ${columnDetail(col)}`, t('editor.sql.columnOf', { target: where })];
}

// Markdown column table for the table-hover card (potygen-style quick info).
export function tableColumnsMarkdown(cols: ColumnInfo[], max = 30): string[] {
  if (cols.length === 0) return [];
  const shown = cols.slice(0, max);
  const rows = shown.map((c) => `| ${c.name} | ${columnDetail(c)} |`);
  const table = [`| ${t('editor.sql.column')} | ${t('editor.sql.type')} |`, '| --- | --- |', ...rows].join('\n');
  return cols.length > shown.length
    ? [table, t('editor.sql.moreColumns', { count: cols.length - shown.length })]
    : [table];
}

function tableLines(info: TableInfo): string[] {
  return [
    t('editor.sql.nameKind', { name: `**${info.name}**`, kind: relationTypeLabel(info.type) }),
    info.schema ? t('editor.sql.schemaName', { name: info.schema }) : '',
  ].filter(Boolean);
}

function virtualKindLabel(isCte: boolean): string {
  return isCte ? t('editor.sql.cte') : t('editor.sql.subquery');
}

function tokenAt(tokens: SqlToken[], offset: number): SqlToken | undefined {
  return tokens.find((tok) => offset >= tok.start && offset < tok.end && isIdentLike(tok));
}

export function analyzeHover(
  stmtText: string,
  offset: number,
  parsed: ParsedQuery,
  tables: TableInfo[],
  schemas: SchemaInfo[],
  driver: DriverType,
): HoverQuery | null {
  const tokens = tokenizeSql(stmtText, driver).filter((tok) => tok.kind !== 'comment');
  const tok = tokenAt(tokens, offset);
  if (!tok) return null;
  // Bare keywords aren't identifiers; quoted tokens always are.
  if (tok.kind === 'ident' && QUOTE_FORCING_KEYWORDS.has(tok.lower)) return null;

  const name = tokenIdentText(tok);
  const nameLc = name.toLowerCase();
  const span = { start: tok.start, end: tok.end };
  const idx = tokens.indexOf(tok);

  // Leading `qual.` / `schema.qual.` segments before the hovered token.
  const segments: string[] = [];
  let k = idx;
  while (
    segments.length < 2 &&
    tokens[k - 1]?.kind === 'punct' &&
    tokens[k - 1]?.text === '.' &&
    isIdentLike(tokens[k - 2])
  ) {
    segments.unshift(tokens[k - 2].text);
    k -= 2;
  }

  if (segments.length > 0) {
    const qualLc = unquoteIdent(segments[segments.length - 1]).toLowerCase();
    const virtual = parsed.virtualColumns.get(qualLc);
    if (virtual) {
      if (!virtual.some((c) => c.toLowerCase() === nameLc)) return null;
      const kind = virtualKindLabel(parsed.ctes.some((c) => c.toLowerCase() === qualLc));
      return { ...span, lines: [`**${name}**`, t('editor.sql.columnOf', { target: `${kind} ${qualLc}` })] };
    }
    const binding = resolveDotCompletion({ segments }, parsed.bindings, tables, schemas, driver);
    if (binding) return { ...span, columnLookup: { bindings: [binding], name: nameLc } };
    return null;
  }

  // Alias or table referenced by this query.
  const bound = parsed.bindings.get(nameLc);
  if (bound) {
    const info = tables.find((tbl) => tbl.name === bound.table && tbl.schema === bound.schema);
    if (bound.table.toLowerCase() !== nameLc) {
      return {
        ...span,
        lines: [
          t('editor.sql.nameKind', {
            name: `**${name}**`,
            kind: t('editor.sql.aliasFor', { table: bound.table }),
          }),
          ...(info ? tableLines(info).slice(1) : []),
        ],
        tableColumns: info ? bound : undefined,
      };
    }
    if (info) return { ...span, lines: tableLines(info), tableColumns: bound };
  }

  // CTE / derived-table alias.
  const virtual = parsed.virtualColumns.get(nameLc);
  if (virtual) {
    const kind = virtualKindLabel(parsed.ctes.some((c) => c.toLowerCase() === nameLc));
    const cols = virtual.length > 0 ? virtual.slice(0, 8).join(', ') + (virtual.length > 8 ? ', …' : '') : '';
    return {
      ...span,
      lines: [
        t('editor.sql.nameKind', { name: `**${name}**`, kind }),
        cols ? t('editor.sql.columnsList', { cols }) : '',
      ].filter(Boolean) as string[],
    };
  }

  // Any table in the connected schema.
  const table = tables.find((tbl) => tbl.name.toLowerCase() === nameLc);
  if (table) {
    return { ...span, lines: tableLines(table), tableColumns: { schema: table.schema, table: table.name } };
  }

  // A schema name.
  const schema = schemas.find((s) => s.name.toLowerCase() === nameLc);
  if (schema) {
    return {
      ...span,
      lines: [t('editor.sql.nameKind', { name: `**${schema.name}**`, kind: t('editor.sql.schema') })],
    };
  }

  // Bare column: search the query's in-scope tables (loaded lazily by the caller).
  const candidates = [...parsed.bindings.values()].filter(
    (b, i, arr) => arr.findIndex((x) => x.schema === b.schema && x.table === b.table) === i,
  );
  if (candidates.length > 0) return { ...span, columnLookup: { bindings: candidates, name: nameLc } };
  return null;
}
