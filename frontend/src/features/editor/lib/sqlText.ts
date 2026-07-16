import type { DriverType } from '@/types';

// Dialect knobs for lexical scanning. No driver = the conservative common subset.
export interface SqlLexOptions {
  hashLineComments: boolean; // MySQL `# ...`
  backslashEscapes: boolean; // MySQL strings: 'it\'s', "a\"b"
  doubleQuoteStrings: boolean; // MySQL default mode: "..." is a string literal, not an identifier
  nestedBlockComments: boolean; // Postgres: /* outer /* inner */ still outer */
  dollarQuotes: boolean; // Postgres $tag$...$tag$; in MySQL `$` is just an identifier char
}

export function lexOptionsFor(driver?: DriverType): SqlLexOptions {
  return {
    hashLineComments: driver === 'mysql',
    backslashEscapes: driver === 'mysql',
    doubleQuoteStrings: driver === 'mysql',
    nestedBlockComments: driver === 'postgres',
    dollarQuotes: driver !== 'mysql',
  };
}

// Index of the terminating '\n', or -1 at EOF; `from` is the first char after the marker.
export function findLineCommentEnd(text: string, from: number): number {
  const nl = text.indexOf('\n', from);
  return nl;
}

// Index just past the closing `*/`, or -1 when unterminated. `from` points at the opening `/*`.
export function findBlockCommentEnd(text: string, from: number, nested: boolean): number {
  let i = from + 2;
  let depth = 1;
  const end = text.length;
  while (i < end) {
    const ch = text[i];
    if (ch === '*' && text[i + 1] === '/') {
      i += 2;
      if (--depth === 0) return i;
    } else if (nested && ch === '/' && text[i + 1] === '*') {
      depth++;
      i += 2;
    } else {
      i++;
    }
  }
  return -1;
}

// Index past the closing quote ('' doubling; optional \x escapes), or -1 when unterminated.
export function findQuoteEnd(
  text: string,
  from: number,
  quote: string,
  doubleEscape: boolean,
  backslashEscapes: boolean,
): number {
  let i = from + 1;
  const end = text.length;
  while (i < end) {
    const ch = text[i];
    if (backslashEscapes && ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) {
      if (doubleEscape && text[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return -1;
}

// Tags never start with a digit, so `$1$` is a placeholder between two `$`, not a quote delimiter.
const DOLLAR_TAG_RE = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

// The `$tag$` / `$$` delimiter starting at `from`, or null when the `$` opens no dollar quote.
export function matchDollarTag(text: string, from: number): string | null {
  DOLLAR_TAG_RE.lastIndex = from;
  return DOLLAR_TAG_RE.exec(text)?.[0] ?? null;
}

// Next scan position past the dollar quote; `end` when unterminated, from+1 when not a dollar quote.
export function skipDollarQuoted(text: string, from: number, end: number): number {
  const tag = matchDollarTag(text, from);
  if (!tag) return from + 1;
  const close = text.indexOf(tag, from + tag.length);
  return close === -1 ? end : close + tag.length;
}

// Standalone E before the quote = Postgres escape string; `1e'…'` / `TABLE'…'` don't qualify.
export function isEscapeStringPrefix(text: string, quoteIdx: number): boolean {
  const prev = text[quoteIdx - 1];
  if (prev !== 'e' && prev !== 'E') return false;
  const before = quoteIdx >= 2 ? text[quoteIdx - 2] : '';
  return !/[\w$'"`]/.test(before);
}
