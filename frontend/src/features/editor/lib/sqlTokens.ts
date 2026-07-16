import {
  findBlockCommentEnd,
  findLineCommentEnd,
  findQuoteEnd,
  isEscapeStringPrefix,
  lexOptionsFor,
  matchDollarTag,
} from '@/features/editor/lib/sqlText';
import type { DriverType } from '@/types';

export type SqlTokenKind =
  | 'ident' // bare identifier or keyword (`lower` carries the lowercased text)
  | 'quoted' // "ident" / `ident`
  | 'string' // '...' (and "..." on MySQL, where it's a literal)
  | 'number' // numeric literal or $n placeholder
  | 'op' // = <> <= >= != :: || + - * / and other symbols
  | 'punct' // . , ( ) ;
  | 'comment';

export interface SqlToken {
  kind: SqlTokenKind;
  text: string;
  lower: string; // lowercased text for ident tokens, '' otherwise
  start: number;
  end: number; // exclusive
  unterminated?: boolean; // string/quoted/comment cut off by the end of input
}

const IDENT_START_RE = /[A-Za-z_]/;
const IDENT_CHAR_RE = /[A-Za-z0-9_$]/;
const DIGIT_RE = /[0-9]/;
const NUMBER_CHAR_RE = /[0-9A-Za-z._]/;
const WS_RE = /\s/;
const TWO_CHAR_OPS = new Set(['<=', '>=', '<>', '!=', '::', '||', ':=']);
const PUNCT = new Set(['.', ',', '(', ')', ';']);

// One linear pass. Dollar-quote delimiters ($tag$) are emitted as ops and their bodies tokenized
// as ordinary SQL, so completion keeps working inside Postgres function bodies.
export function tokenizeSql(text: string, driver?: DriverType): SqlToken[] {
  const opts = lexOptionsFor(driver);
  const len = text.length;
  const tokens: SqlToken[] = [];
  const push = (kind: SqlTokenKind, start: number, end: number, unterminated?: boolean) => {
    const raw = text.slice(start, end);
    tokens.push({
      kind,
      text: raw,
      lower: kind === 'ident' ? raw.toLowerCase() : '',
      start,
      end,
      ...(unterminated ? { unterminated: true } : null),
    });
  };

  let i = 0;
  while (i < len) {
    const ch = text[i];
    if (WS_RE.test(ch)) {
      i++;
      continue;
    }
    const next = text[i + 1];

    if ((ch === '-' && next === '-') || (ch === '#' && opts.hashLineComments)) {
      const nl = findLineCommentEnd(text, ch === '#' ? i + 1 : i + 2);
      const end = nl === -1 ? len : nl;
      push('comment', i, end, nl === -1);
      i = end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = findBlockCommentEnd(text, i, opts.nestedBlockComments);
      push('comment', i, close === -1 ? len : close, close === -1);
      i = close === -1 ? len : close;
      continue;
    }
    if (ch === "'" || (ch === '"' && opts.doubleQuoteStrings)) {
      const escapes = opts.backslashEscapes || isEscapeStringPrefix(text, i);
      const close = findQuoteEnd(text, i, ch, true, escapes);
      push('string', i, close === -1 ? len : close, close === -1);
      i = close === -1 ? len : close;
      continue;
    }
    if (ch === '"' || ch === '`') {
      const close = findQuoteEnd(text, i, ch, true, false);
      push('quoted', i, close === -1 ? len : close, close === -1);
      i = close === -1 ? len : close;
      continue;
    }
    if (ch === '$') {
      if (opts.dollarQuotes) {
        const tag = matchDollarTag(text, i);
        if (tag) {
          push('op', i, i + tag.length);
          i += tag.length;
          continue;
        }
      }
      if (next !== undefined && DIGIT_RE.test(next)) {
        let j = i + 1;
        while (j < len && DIGIT_RE.test(text[j])) j++;
        push('number', i, j); // $n placeholder: expression-valued, like a literal
        i = j;
        continue;
      }
      push('op', i, i + 1);
      i++;
      continue;
    }
    if (IDENT_START_RE.test(ch)) {
      let j = i + 1;
      while (j < len && IDENT_CHAR_RE.test(text[j])) j++;
      push('ident', i, j);
      i = j;
      continue;
    }
    if (DIGIT_RE.test(ch)) {
      let j = i + 1;
      while (j < len && NUMBER_CHAR_RE.test(text[j])) j++;
      push('number', i, j);
      i = j;
      continue;
    }
    if (PUNCT.has(ch)) {
      push('punct', i, i + 1);
      i++;
      continue;
    }
    if (next !== undefined && TWO_CHAR_OPS.has(ch + next)) {
      push('op', i, i + 2);
      i += 2;
      continue;
    }
    push('op', i, i + 1);
    i++;
  }

  return tokens;
}

// Unquotes a quoted token's text ("a""b" → a"b, `x` → x); idents pass through.
export function tokenIdentText(t: SqlToken): string {
  if (t.kind !== 'quoted') return t.text;
  const quote = t.text[0];
  let inner = t.text.slice(1, t.unterminated ? undefined : -1);
  if (quote === '"') inner = inner.replace(/""/g, '"');
  if (quote === '`') inner = inner.replace(/``/g, '`');
  return inner;
}

export function isIdentLike(t: SqlToken | undefined): t is SqlToken {
  return t !== undefined && (t.kind === 'ident' || t.kind === 'quoted');
}

export function isKeyword(t: SqlToken | undefined, word: string): boolean {
  return t !== undefined && t.kind === 'ident' && t.lower === word;
}

// Index of the previous / next non-comment token, or -1.
export function prevCodeToken(tokens: SqlToken[], from: number): number {
  for (let i = from - 1; i >= 0; i--) {
    if (tokens[i].kind !== 'comment') return i;
  }
  return -1;
}

export function nextCodeToken(tokens: SqlToken[], from: number): number {
  for (let i = from + 1; i < tokens.length; i++) {
    if (tokens[i].kind !== 'comment') return i;
  }
  return -1;
}
