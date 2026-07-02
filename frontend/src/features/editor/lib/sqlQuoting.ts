import { quoteIdent } from '@/features/editor/lib/sqlIdentifiers';
import type { DriverType } from '@/types';

export const ALIAS_STOP_WORDS = new Set([
  'on',
  'and',
  'or',
  'where',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'natural',
  'as',
  'set',
  'order',
  'group',
  'by',
  'having',
  'limit',
  'offset',
  'union',
  'into',
  'values',
  'select',
  'from',
  'using',
  'lateral',
]);

export function columnCacheKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

export function unquoteIdent(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/""/g, '"');
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.length >= 2 && s.startsWith('`') && s.endsWith('`')) {
    return s.slice(1, -1);
  }
  return s;
}

// Common SQL keywords that are also plausible identifier names; inserting them unquoted from
// autocomplete (e.g. a column literally named `order`) would be a syntax error.
const QUOTE_FORCING_KEYWORDS = new Set([
  ...ALIAS_STOP_WORDS,
  'table',
  'column',
  'user',
  'index',
  'view',
  'key',
  'primary',
  'foreign',
  'references',
  'constraint',
  'default',
  'check',
  'unique',
  'create',
  'drop',
  'alter',
  'insert',
  'update',
  'delete',
  'truncate',
  'grant',
  'revoke',
  'case',
  'when',
  'then',
  'else',
  'end',
  'null',
  'true',
  'false',
  'not',
  'is',
  'in',
  'like',
  'between',
  'exists',
  'distinct',
  'all',
  'any',
  'asc',
  'desc',
  'with',
  'recursive',
  'returning',
  'cast',
  'collate',
]);

export function identifierNeedsQuote(name: string, driver: DriverType): boolean {
  if (!name) return false;
  if (/^\d/.test(name)) return true;
  if (QUOTE_FORCING_KEYWORDS.has(name.toLowerCase())) return true;
  if (driver === 'postgres') return /[^a-z0-9_]/.test(name);
  if (driver === 'mysql') return /[^a-zA-Z0-9_$]/.test(name);
  return /[^a-zA-Z0-9_]/.test(name);
}

export function formatSqlIdentifier(name: string, driver: DriverType): string {
  if (!name) return name;
  if (!identifierNeedsQuote(name, driver)) return name;
  return quoteIdent(driver, name);
}
