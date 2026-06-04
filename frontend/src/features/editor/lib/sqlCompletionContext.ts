import { unquoteIdent } from '@/features/editor/lib/sqlQuoting';

const TABLE_SOURCE_RE =
  /\b(?:FROM|(?:(?:LEFT|RIGHT|FULL|INNER|CROSS|NATURAL)\s+)*JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+/gi;

const STOPS_TABLE_CONTEXT =
  /\b(WHERE|ON|SET|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|RETURNING|VALUES|SELECT)\b/i;

export interface DotCompletion {
  segments: string[];
  prefix: string;
}

const IDENT_OR_QUOTED = `(?:"[^"]+")|(?:'[^']+')|(?:\`[^\`]+\`)|[a-zA-Z_][\\w]*`;
const TRIPLE_DOT_RE = new RegExp(
  `(${IDENT_OR_QUOTED})\\s*\\.\\s*(${IDENT_OR_QUOTED})\\s*\\.\\s*([\\w"\`]*)$`
);
const SINGLE_DOT_RE = new RegExp(`(${IDENT_OR_QUOTED})\\s*\\.\\s*([\\w"\`]*)$`);

export function parseDotCompletion(before: string): DotCompletion | null {
  const triple = before.match(TRIPLE_DOT_RE);
  if (triple) return { segments: [triple[1], triple[2]], prefix: triple[3] };

  const single = before.match(SINGLE_DOT_RE);
  if (single) return { segments: [single[1]], prefix: single[2] };

  return null;
}

export interface TableContextMatch {
  schemaPrefix?: string;
  prefix: string;
}

export function matchTableContext(before: string): TableContextMatch | null {
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  TABLE_SOURCE_RE.lastIndex = 0;
  while ((m = TABLE_SOURCE_RE.exec(before)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < 0) return null;

  const segment = before.slice(lastEnd);
  if (STOPS_TABLE_CONTEXT.test(segment)) return null;

  const schemaDot = segment.match(/^\s*([a-zA-Z_][\w]*)\s*\.\s*([\w."`]*)$/);
  if (schemaDot) {
    return {
      schemaPrefix: schemaDot[1],
      prefix: unquoteIdent(schemaDot[2]).toLowerCase(),
    };
  }

  if (/^\s*[a-zA-Z_][\w]*\s*\.\s*$/.test(segment)) {
    const schemaOnly = segment.match(/^\s*([a-zA-Z_][\w]*)\s*\.\s*$/);
    if (schemaOnly) return { schemaPrefix: schemaOnly[1], prefix: '' };
  }

  const ident = segment.match(/^\s*((?:"[^"]*)?[\w."`]*)$/);
  if (!ident) return null;

  const raw = (ident[1] || '').trim();
  if (!raw) return { prefix: '' };

  return { prefix: unquoteIdent(raw).toLowerCase() };
}

export function isValueContext(before: string): boolean {
  if (/[<>:!]=\s*[\w."'`]*$/.test(before)) return false;
  return /(?:^|[^\w])=\s*[\w."'`]*$/.test(before);
}

export function isUpdateSetColumnContext(before: string): boolean {
  const match = before.match(/\bUPDATE\b[\s\S]*\bSET\s+([\s\S]*)$/i);
  if (!match) return false;
  if (isValueContext(before)) return false;
  return !/\bWHERE\b/i.test(match[1]);
}

export function isColumnFilterContext(before: string): boolean {
  if (isValueContext(before) || matchTableContext(before)) return false;
  if (!/\b(WHERE|ON|AND|OR|HAVING)\b/i.test(before)) return false;

  if (/\bFROM\b/i.test(before) && /\b(SELECT|DELETE)\b/i.test(before)) return true;
  if (/\bUPDATE\b/i.test(before) && /\bSET\b/i.test(before)) return true;
  return false;
}

// Generic keyword path showed no identifiers in ORDER BY / GROUP BY; this predicate unlocks column suggestions there.
export function isOrderOrGroupContext(before: string): boolean {
  if (isValueContext(before) || matchTableContext(before)) return false;
  if (parseDotCompletion(before)) return false;

  const re = /\b(?:ORDER|GROUP)\s+BY\b/gi;
  let bodyStart = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) bodyStart = m.index + m[0].length;
  if (bodyStart < 0) return false;

  const tail = before.slice(bodyStart);
  return !/\b(WHERE|FROM|HAVING|LIMIT|OFFSET|UNION|SELECT)\b/i.test(tail);
}

// Caret is in the trailing LIMIT/OFFSET clause (after the keyword + a space), which takes only a
// number and an optional OFFSET - so columns/tables/keywords don't belong. False while still
// typing the keyword itself (`LIMI`/`LIMIT`).
export function isLimitOffsetContext(before: string): boolean {
  const re = /\b(?:LIMIT|OFFSET)\b/gi;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) lastEnd = m.index + m[0].length;
  if (lastEnd < 0) return false;
  const tail = before.slice(lastEnd);
  if (!/^\s/.test(tail)) return false; // caret still on the keyword, not in its argument
  // A subquery's LIMIT followed by an outer clause is no longer the numeric tail.
  return !/[)]|\b(SELECT|FROM|WHERE|JOIN|GROUP|ORDER|HAVING|UNION|VALUES|SET|INTO)\b/i.test(tail);
}

// Words after which a column/table/expression is the natural next token.
const EXPRESSION_LEAD_WORDS = new Set([
  'from', 'join', 'on', 'where', 'and', 'or', 'not', 'having', 'by', 'set', 'select',
  'in', 'like', 'between', 'distinct', 'when', 'then', 'else',
]);

// Whether the token before the caret expects an identifier/expression next - a clause keyword
// (FROM/WHERE/ORDER BY/ON/…), a comparison/logical operator, a comma, or `(`. False after a
// completed identifier/literal/ASC/DESC/`)`. The in-progress word is stripped first, so `WHERE ema|`
// resolves to the keyword before it.
export function expectsExpression(before: string): boolean {
  const partial = before.match(/[\w."`]*$/)?.[0] ?? '';
  const head = before.slice(0, before.length - partial.length).replace(/\s+$/, '');
  if (!head) return true;
  const last = head[head.length - 1];
  if (last === ',' || last === '(' || last === '=' || last === '<' || last === '>') return true;
  const word = head.match(/[A-Za-z_][\w]*$/)?.[0];
  return word ? EXPRESSION_LEAD_WORDS.has(word.toLowerCase()) : false;
}

// Caret immediately after a clause keyword with no trailing space (e.g. Ctrl+Space after WHERE) - without this the keyword is matched as the word being typed, producing an empty list.
export type ClauseBodyKind = 'filter' | 'order-group' | 'set' | 'table';

const TRAILING_ORDER_GROUP_RE = /(?:^|[^\w])(?:ORDER|GROUP)\s+BY$/i;
const TRAILING_FILTER_RE = /(?:^|[^\w])(?:WHERE|HAVING|ON|AND|OR)$/i;
const TRAILING_SET_RE = /(?:^|[^\w])SET$/i;
const TRAILING_TABLE_RE = /(?:^|[^\w])(?:FROM|JOIN)$/i;

export function clauseBodyStart(before: string): ClauseBodyKind | null {
  if (!before || /\s$/.test(before)) return null;
  if (parseDotCompletion(before) || isValueContext(before)) return null;

  if (TRAILING_ORDER_GROUP_RE.test(before)) return 'order-group';
  if (TRAILING_SET_RE.test(before) && /\bUPDATE\b/i.test(before)) return 'set';
  if (TRAILING_FILTER_RE.test(before)) return 'filter';
  if (TRAILING_TABLE_RE.test(before)) return 'table';
  return null;
}

export function valueContextPrefix(before: string): string {
  // Allow (and skip past) an opening quote so a started literal like `= 'ab` filters by `ab`.
  const m = before.match(/=\s*['"`]?([\w."`]*)$/);
  return m ? unquoteIdent(m[1]).toLowerCase() : '';
}

export function updateSetColumnPrefix(before: string): string {
  const setMatch = before.match(/\bSET\s+([\s\S]*)$/i);
  if (!setMatch) return '';
  let tail = setMatch[1];
  const whereIdx = tail.search(/\bWHERE\b/i);
  if (whereIdx >= 0) tail = tail.slice(0, whereIdx);
  const lastComma = tail.lastIndexOf(',');
  const fragment = (lastComma >= 0 ? tail.slice(lastComma + 1) : tail).trim();
  const beforeEq = fragment.split('=')[0] ?? '';
  const ident = beforeEq.match(/((?:"[^"]+")|(?:'[^']+')|[\w.]+)$/);
  return ident ? unquoteIdent(ident[1]).toLowerCase() : '';
}

// ASC/DESC valid only in ORDER BY (not GROUP BY) and only after a column is already in the current sort term.
export function sortDirectionAllowed(before: string): boolean {
  const re = /\b(ORDER|GROUP)\s+BY\b/gi;
  let kind = '';
  let bodyStart = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before)) !== null) {
    kind = m[1].toUpperCase();
    bodyStart = m.index + m[0].length;
  }
  if (kind !== 'ORDER') return false;

  let term = before.slice(bodyStart);
  const comma = term.lastIndexOf(',');
  if (comma >= 0) term = term.slice(comma + 1);
  // A direction is already present for this sort key - don't offer a second one.
  if (/\b(?:ASC|DESC)\s*$/i.test(term)) return false;
  return /[\w"`)]\s*$/.test(term.replace(/[\w"`]*$/, ''));
}
