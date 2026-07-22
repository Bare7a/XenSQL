import { DriverLruCache } from '@/features/editor/lib/sqlCache';
import { isIdentLike, isKeyword, type SqlToken, tokenIdentText, tokenizeSql } from '@/features/editor/lib/sqlTokens';
import type { DriverType } from '@/types';

// Statement-level facts about the text before the cursor, computed once per analysis.
export interface StatementShape {
  atStatementStart: boolean;
  hasFrom: boolean;
  hasJoin: boolean;
  inWhere: boolean;
  inFilterClause: boolean; // WHERE / HAVING / ON seen
  inSelectList: boolean; // SELECT present, FROM not yet
  hasInsert: boolean; // INSERT or REPLACE
  hasUpdate: boolean;
  hasCase: boolean;
  orderBySeen: boolean;
  groupBySeen: boolean;
  insertBody: boolean; // INSERT followed by its VALUES / SELECT body
  returningSlot: boolean; // a write statement far enough along for RETURNING
  joinable: boolean; // a JOIN keyword parses here (FROM present, not inside WHERE)
  afterOnKeyword: boolean; // the caret sits right after a JOIN's ON - a join condition starts here
}

// What the caret sits in: `prefix` = partial word (lowercased), `replaceLen` = raw chars to replace.
export type CursorSlot =
  | { kind: 'none' } // inside a comment or a plain string literal
  | { kind: 'dot'; segments: string[]; prefix: string; replaceLen: number }
  | { kind: 'table'; prefix: string; replaceLen: number; leadingSpace: boolean }
  | { kind: 'insert-columns'; used: string[]; prefix: string; replaceLen: number }
  | { kind: 'set-column'; prefix: string; replaceLen: number; leadingSpace: boolean }
  | { kind: 'filter-start'; leadingSpace: true } // caret butted against WHERE/AND/… - columns follow
  | { kind: 'value'; prefix: string; replaceLen: number }
  | {
      kind: 'order-group';
      group: boolean;
      expectsExpr: boolean;
      directionAllowed: boolean;
      trailingKeywords: string[];
      prefix: string;
      replaceLen: number;
      leadingSpace: boolean;
    }
  | { kind: 'limit'; offerOffset: boolean; prefix: string; replaceLen: number }
  | { kind: 'general'; prefix: string; replaceLen: number; inFilter: boolean; expectsExpr: boolean };

export interface SqlCursor {
  slot: CursorSlot;
  shape: StatementShape;
}

const COMPARISON_OPS = new Set(['=', '<', '>', '<=', '>=', '<>', '!=']);
const STOPS_TABLE = new Set([
  'where',
  'on',
  'set',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'union',
  'returning',
  'values',
  'select',
]);
const BY_TERMINATORS = new Set(['where', 'from', 'having', 'limit', 'offset', 'union', 'select']);
const LIMIT_TERMINATORS = new Set([
  'select',
  'from',
  'where',
  'join',
  'group',
  'order',
  'having',
  'union',
  'values',
  'set',
  'into',
]);
const FILTER_START_KEYWORDS = new Set(['where', 'having', 'on', 'and', 'or']);

// Tokens after which a column/table/expression is the natural next thing to type.
const EXPRESSION_LEAD_WORDS = new Set([
  'from',
  'join',
  'on',
  'where',
  'and',
  'or',
  'not',
  'having',
  'by',
  'set',
  'select',
  'in',
  'like',
  'ilike',
  'regexp',
  'rlike',
  'glob',
  'match',
  'to', // SIMILAR TO
  'between',
  'distinct',
  'when',
  'then',
  'else',
]);

const isPunct = (t: SqlToken | undefined, ch: string) => t !== undefined && t.kind === 'punct' && t.text === ch;
const isComparison = (t: SqlToken | undefined) => t !== undefined && t.kind === 'op' && COMPARISON_OPS.has(t.text);

interface Markers {
  srcIdx: number; // last table-source keyword (FROM/JOIN/INTO/UPDATE)
  byIdx: number; // last ORDER|GROUP BY's `by`
  byGroup: boolean;
  limitIdx: number; // last LIMIT/OFFSET keyword
  offsetSeen: boolean;
  setIdx: number; // last UPDATE's SET
  intoIdx: number; // last INSERT/REPLACE INTO's `into`
  selectSeen: boolean;
  deleteSeen: boolean;
}

function computeShape(code: SqlToken[], partial: SqlToken | null): { shape: StatementShape; m: Markers } {
  const m: Markers = {
    srcIdx: -1,
    byIdx: -1,
    byGroup: false,
    limitIdx: -1,
    offsetSeen: false,
    setIdx: -1,
    intoIdx: -1,
    selectSeen: false,
    deleteSeen: false,
  };
  let hasFrom = false;
  let hasJoin = false;
  let inWhere = false;
  let inFilterClause = false;
  let hasInsert = false;
  let hasUpdate = false;
  let hasCase = false;
  let orderBySeen = false;
  let groupBySeen = false;
  let insertBody = false;

  for (let i = 0; i < code.length; i++) {
    const t = code[i];
    if (t.kind !== 'ident' || t === partial) continue;
    switch (t.lower) {
      case 'from':
        if (!isKeyword(code[i - 1], 'distinct')) {
          hasFrom = true;
          m.srcIdx = i;
        }
        break;
      case 'join':
        hasJoin = true;
        m.srcIdx = i;
        break;
      case 'into':
        if (isKeyword(code[i - 1], 'insert') || isKeyword(code[i - 1], 'replace')) {
          m.srcIdx = i;
          m.intoIdx = i;
        }
        break;
      case 'update':
        hasUpdate = true;
        m.srcIdx = i;
        break;
      case 'where':
        inWhere = true;
        inFilterClause = true;
        break;
      case 'having':
      case 'on':
        inFilterClause = true;
        break;
      case 'select':
        m.selectSeen = true;
        if (hasInsert) insertBody = true;
        break;
      case 'values':
        if (hasInsert) insertBody = true;
        break;
      case 'insert':
      case 'replace':
        hasInsert = true;
        break;
      case 'delete':
        m.deleteSeen = true;
        break;
      case 'case':
        hasCase = true;
        break;
      case 'set':
        if (hasUpdate) m.setIdx = i;
        break;
      case 'by':
        if (isKeyword(code[i - 1], 'order') || isKeyword(code[i - 1], 'group')) {
          m.byIdx = i;
          m.byGroup = isKeyword(code[i - 1], 'group');
          if (m.byGroup) groupBySeen = true;
          else orderBySeen = true;
        }
        break;
      case 'limit':
      case 'offset':
        m.limitIdx = i;
        if (t.lower === 'offset') m.offsetSeen = true;
        break;
    }
  }

  const shape: StatementShape = {
    atStatementStart: code.length === 0 || (code.length === 1 && code[0] === partial),
    hasFrom,
    hasJoin,
    inWhere,
    inFilterClause,
    inSelectList: m.selectSeen && !hasFrom,
    hasInsert,
    hasUpdate,
    hasCase,
    orderBySeen,
    groupBySeen,
    insertBody,
    returningSlot: insertBody || m.deleteSeen || (hasUpdate && m.setIdx !== -1),
    joinable: hasFrom && !inWhere,
    afterOnKeyword: false, // filled in by analyzeSqlCursor (cursor-local, not statement-global)
  };
  return { shape, m };
}

// Whether the last complete token leaves an expression slot open.
function expectsExpression(prev: SqlToken | undefined): boolean {
  if (!prev) return true;
  if (prev.kind === 'punct') return prev.text === ',' || prev.text === '(';
  if (prev.kind === 'op') return COMPARISON_OPS.has(prev.text);
  return prev.kind === 'ident' && EXPRESSION_LEAD_WORDS.has(prev.lower);
}

function lowerIdent(t: SqlToken): string {
  return tokenIdentText(t).toLowerCase();
}

// Same before-text is analyzed thrice per completion request.
const cursorCache = new DriverLruCache<SqlCursor>(16);

export function analyzeSqlCursor(before: string, driver?: DriverType): SqlCursor {
  const cache = cursorCache.of(driver);
  return cache.get(before) ?? cache.set(before, analyzeCursor(before, driver));
}

function analyzeCursor(before: string, driver?: DriverType): SqlCursor {
  const all = tokenizeSql(before, driver);
  const len = before.length;

  // In-comment iff the cursor sits in a comment that hasn't closed yet (line comment with no
  // newline, or an open block comment). A closed comment ending at the cursor is code position.
  const lastAny = all[all.length - 1];
  if (lastAny?.kind === 'comment' && lastAny.end >= len && lastAny.unterminated) {
    return { slot: { kind: 'none' }, shape: computeShape([], null).shape };
  }

  const code: SqlToken[] = [];
  for (const t of all) if (t.kind !== 'comment') code.push(t);

  // The token being typed (touching the cursor), if any.
  const last = code[code.length - 1];
  let partial: SqlToken | null = null;
  if (last && last.end >= len) {
    if (last.kind === 'ident' || last.kind === 'number' || (last.kind === 'quoted' && last.unterminated)) {
      partial = last;
    } else if (last.kind === 'string' && last.unterminated) {
      // Typing inside a literal: a value when it follows a comparison, otherwise no completions.
      const prev = code[code.length - 2];
      const { shape } = computeShape(code, null);
      if (isComparison(prev)) {
        const prefix = before.slice(last.start + 1).toLowerCase();
        return { slot: { kind: 'value', prefix, replaceLen: len - last.start }, shape };
      }
      return { slot: { kind: 'none' }, shape };
    }
  }

  const { shape, m } = computeShape(code, partial);
  const completeEnd = partial ? code.length - 1 : code.length; // code[0..completeEnd) are complete tokens
  const prev = code[completeEnd - 1];
  const prefix = partial ? lowerIdent(partial) : '';
  const replaceLen = partial ? len - partial.start : 0;
  shape.afterOnKeyword = shape.hasJoin && (isKeyword(prev, 'on') || (partial !== null && partial.lower === 'on'));

  // Qualified access: `alias.` / `schema.table.` (+ partial). Raw segments; resolvers unquote.
  if (isPunct(prev, '.') && isIdentLike(code[completeEnd - 2])) {
    const seg1 = code[completeEnd - 2];
    const segments: string[] = [seg1.text];
    if (isPunct(code[completeEnd - 3], '.') && isIdentLike(code[completeEnd - 4])) {
      segments.unshift(code[completeEnd - 4].text);
    }
    return { slot: { kind: 'dot', segments, prefix: partial?.text ?? '', replaceLen }, shape };
  }

  // Value slot: right of a comparison operator.
  if (isComparison(prev)) {
    return { slot: { kind: 'value', prefix, replaceLen }, shape };
  }

  // Caret butted against a just-typed clause keyword (`WHERE|`, `ORDER BY|`, `FROM|`): the word is
  // complete, so offer the clause body space-prefixed rather than treating it as a prefix filter.
  if (partial && partial.kind === 'ident') {
    const kw = partial.lower;
    const prevKw = code[code.length - 2];
    if (kw === 'by' && (isKeyword(prevKw, 'order') || isKeyword(prevKw, 'group'))) {
      return {
        slot: {
          kind: 'order-group',
          group: isKeyword(prevKw, 'group'),
          expectsExpr: true,
          directionAllowed: false,
          trailingKeywords: [],
          prefix: '',
          replaceLen: 0,
          leadingSpace: true,
        },
        shape,
      };
    }
    if (kw === 'set' && shape.hasUpdate) {
      return { slot: { kind: 'set-column', prefix: '', replaceLen: 0, leadingSpace: true }, shape };
    }
    if (FILTER_START_KEYWORDS.has(kw) || (kw === 'from' && isKeyword(prevKw, 'distinct'))) {
      return { slot: { kind: 'filter-start', leadingSpace: true }, shape };
    }
    if (kw === 'from' || kw === 'join') {
      return { slot: { kind: 'table', prefix: '', replaceLen: 0, leadingSpace: true }, shape };
    }
  }

  // UPDATE … SET column list: a fresh column position right after SET or after a comma.
  if (m.setIdx !== -1 && !shape.inWhere) {
    let fresh = true;
    for (let i = m.setIdx + 1; i < completeEnd; i++) {
      const t = code[i];
      if (isPunct(t, ',')) fresh = true;
      else if (t.kind === 'op' && t.text === '=') fresh = false;
    }
    if (fresh) {
      return { slot: { kind: 'set-column', prefix, replaceLen, leadingSpace: false }, shape };
    }
  }

  // INSERT INTO tbl (…: inside the column-list paren (opened right after the table name).
  if (m.intoIdx !== -1) {
    let i = m.intoIdx + 1;
    if (isIdentLike(code[i])) {
      i++;
      if (isPunct(code[i], '.') && isIdentLike(code[i + 1])) i += 2;
      if (isPunct(code[i], '(')) {
        let open = true;
        const used: string[] = [];
        for (let j = i + 1; j < completeEnd; j++) {
          const t = code[j];
          if (isPunct(t, ')')) {
            open = false;
            break;
          }
          if (isIdentLike(t) && !isPunct(code[j + 1], '.') && !isPunct(code[j - 1], '.')) used.push(lowerIdent(t));
        }
        if (open && i < completeEnd) {
          return { slot: { kind: 'insert-columns', used, prefix, replaceLen }, shape };
        }
      }
    }
  }

  // Table slot: after the last FROM/JOIN/INTO/UPDATE with nothing but refs/commas since.
  if (m.srcIdx !== -1) {
    let stopped = false;
    for (let i = m.srcIdx + 1; i < completeEnd; i++) {
      const t = code[i];
      if (t.kind === 'ident' && STOPS_TABLE.has(t.lower)) {
        stopped = true;
        break;
      }
    }
    if (!stopped) {
      const tailLen = completeEnd - (m.srcIdx + 1);
      const lastTail = code[completeEnd - 1];
      if (tailLen === 0 || isPunct(lastTail, ',')) {
        return { slot: { kind: 'table', prefix, replaceLen, leadingSpace: false }, shape };
      }
    }
  }

  // ORDER BY / GROUP BY body, until a terminating clause follows the list.
  if (m.byIdx !== -1) {
    let terminated = false;
    let termStart = m.byIdx + 1; // first token of the current sort term
    for (let i = m.byIdx + 1; i < completeEnd; i++) {
      const t = code[i];
      if (t.kind === 'ident' && BY_TERMINATORS.has(t.lower)) {
        terminated = true;
        break;
      }
      if (isPunct(t, ',')) termStart = i + 1;
    }
    if (!terminated) {
      const expectsExpr = expectsExpression(prev);
      const term = code.slice(termStart, completeEnd);
      const termLast = term[term.length - 1];
      const directionAllowed =
        !m.byGroup &&
        termLast !== undefined &&
        !(termLast.kind === 'ident' && (termLast.lower === 'asc' || termLast.lower === 'desc')) &&
        (termLast.kind === 'ident' ||
          termLast.kind === 'quoted' ||
          termLast.kind === 'number' ||
          isPunct(termLast, ')'));
      const trailingKeywords = expectsExpr
        ? []
        : m.byGroup
          ? ['HAVING', 'ORDER BY', 'LIMIT', 'OFFSET']
          : ['LIMIT', 'OFFSET'];
      return {
        slot: {
          kind: 'order-group',
          group: m.byGroup,
          expectsExpr,
          directionAllowed,
          trailingKeywords,
          prefix,
          replaceLen,
          leadingSpace: false,
        },
        shape,
      };
    }
  }

  // LIMIT / OFFSET tail: takes a number (and at most one OFFSET), not columns/keywords.
  if (m.limitIdx !== -1 && code[m.limitIdx] !== partial) {
    let active = true;
    let limitHasValue = false;
    for (let i = m.limitIdx + 1; i < code.length; i++) {
      const t = code[i];
      if (t === partial) continue;
      if (isPunct(t, ')') || (t.kind === 'ident' && LIMIT_TERMINATORS.has(t.lower))) {
        active = false;
        break;
      }
      if (t.kind === 'number' || (t.kind === 'ident' && t.lower === 'all')) limitHasValue = true;
    }
    if (active) {
      const offerOffset = code[m.limitIdx].lower === 'limit' && limitHasValue && !m.offsetSeen;
      return { slot: { kind: 'limit', offerOffset, prefix, replaceLen }, shape };
    }
  }

  // Column-filter position: a filter keyword has appeared and the statement is one that filters.
  let filterKeywordSeen = shape.inFilterClause;
  for (let i = 0; !filterKeywordSeen && i < completeEnd; i++) {
    const t = code[i];
    if (t.kind === 'ident' && (t.lower === 'and' || t.lower === 'or')) filterKeywordSeen = true;
  }
  const inFilter =
    filterKeywordSeen && ((shape.hasFrom && (m.selectSeen || m.deleteSeen)) || (shape.hasUpdate && m.setIdx !== -1));

  return {
    slot: { kind: 'general', prefix, replaceLen, inFilter, expectsExpr: expectsExpression(prev) },
    shape,
  };
}
