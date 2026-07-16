import {
  findBlockCommentEnd,
  findLineCommentEnd,
  findQuoteEnd,
  isEscapeStringPrefix,
  lexOptionsFor,
  type SqlLexOptions,
  skipDollarQuoted,
} from '@/features/editor/lib/sqlText';
import type { DriverType } from '@/types';

export interface SqlStatement {
  text: string; // includes trailing semicolon when present
  runLine: number; // 1-based line of the first non-whitespace character (used for the run glyph)
  start: number; // offset of the statement's slice start in the source (contiguous with the previous end)
  end: number; // offset just past the statement (exclusive)
}

const WHITESPACE_RE = /\s/;

function firstCodeOffset(text: string, from: number, to: number, opts: SqlLexOptions): number {
  let i = from;
  while (i < to) {
    const ch = text[i];
    if (ch === undefined) break;
    if (WHITESPACE_RE.test(ch)) {
      i++;
      continue;
    }
    if ((ch === '-' && text[i + 1] === '-') || (ch === '#' && opts.hashLineComments)) {
      const nl = findLineCommentEnd(text, i + (ch === '#' ? 1 : 2));
      if (nl === -1 || nl >= to) return -1;
      i = nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = findBlockCommentEnd(text, i, opts.nestedBlockComments);
      if (close === -1) return -1;
      i = close;
      continue;
    }
    return i;
  }
  return -1;
}

// mysql-client `DELIMITER xx` line: switches the terminator so procedure bodies can contain `;`.
const DELIMITER_LINE_RE = /DELIMITER[ \t]+(\S+)[ \t]*(?:\r?\n|$)/iy;

export function parseSqlStatements(sql: string, driver?: DriverType): SqlStatement[] {
  const opts = lexOptionsFor(driver);
  const clientDelimiters = driver === 'mysql';
  const statements: SqlStatement[] = [];
  const len = sql.length;
  let stmtStart = 0;
  let delimiter = ';';
  let i = 0;

  // Statements are pushed in source order, so lineAt scans incrementally instead of from offset 0.
  let lineScanPos = 0;
  let lineScanLine = 1;
  const lineAt = (offset: number): number => {
    for (let p = lineScanPos; p < offset; p++) {
      if (sql.charCodeAt(p) === 10) lineScanLine++;
    }
    lineScanPos = offset;
    return lineScanLine;
  };

  // text covers [stmtStart, contentEnd); the statement's region extends to sliceEnd. For `;` both
  // include the terminator; a custom delimiter is excluded from text (the server never sees it).
  const pushStatement = (contentEnd: number, sliceEnd: number) => {
    const start = stmtStart;
    const text = sql.slice(start, contentEnd).trim();
    if (!text) {
      stmtStart = sliceEnd;
      return;
    }
    const codeAt = firstCodeOffset(sql, start, contentEnd, opts);
    if (codeAt < 0) {
      stmtStart = sliceEnd;
      return;
    }
    statements.push({ text, runLine: lineAt(codeAt), start, end: sliceEnd });
    stmtStart = sliceEnd;
  };

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (clientDelimiters && (ch === 'd' || ch === 'D')) {
      DELIMITER_LINE_RE.lastIndex = i;
      const m = DELIMITER_LINE_RE.exec(sql);
      // Only when DELIMITER is the first thing on its line (matching the mysql client).
      if (m && sql.slice(sql.lastIndexOf('\n', i - 1) + 1, i).trim() === '') {
        pushStatement(i, i); // anything pending stays its own (unterminated) statement
        delimiter = m[1];
        i += m[0].length;
        stmtStart = i;
        continue;
      }
    }

    if ((ch === '-' && next === '-') || (ch === '#' && opts.hashLineComments)) {
      const nl = findLineCommentEnd(sql, i + (ch === '#' ? 1 : 2));
      i = nl === -1 ? len : nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = findBlockCommentEnd(sql, i, opts.nestedBlockComments);
      i = close === -1 ? len : close;
      continue;
    }
    if (ch === "'") {
      const close = findQuoteEnd(sql, i, ch, true, opts.backslashEscapes || isEscapeStringPrefix(sql, i));
      i = close === -1 ? len : close;
      continue;
    }
    if (ch === '"') {
      const close = findQuoteEnd(sql, i, ch, true, opts.backslashEscapes && opts.doubleQuoteStrings);
      i = close === -1 ? len : close;
      continue;
    }
    if (ch === '`') {
      const close = findQuoteEnd(sql, i, ch, true, false);
      i = close === -1 ? len : close;
      continue;
    }
    if (ch === '$' && opts.dollarQuotes) {
      i = skipDollarQuoted(sql, i, len);
      continue;
    }
    if (delimiter === ';' ? ch === ';' : sql.startsWith(delimiter, i)) {
      if (delimiter === ';') pushStatement(i + 1, i + 1);
      else pushStatement(i, i + delimiter.length);
      i += delimiter.length;
      continue;
    }

    i++;
  }

  const trailing = sql.slice(stmtStart).trim();
  if (trailing) {
    const codeAt = firstCodeOffset(sql, stmtStart, len, opts);
    if (codeAt >= 0) {
      statements.push({ text: trailing, runLine: lineAt(codeAt), start: stmtStart, end: len });
    }
  }

  return statements;
}

export function findStatementAtRunLine(statements: SqlStatement[], line: number): SqlStatement | undefined {
  return statements.find((s) => s.runLine === line);
}

// The statement whose [start, end) range contains offset (cursor), if any.
export function findStatementAtOffset(statements: SqlStatement[], offset: number): SqlStatement | undefined {
  return statements.find((s) => offset >= s.start && offset < s.end);
}

// Start offset of the statement the cursor sits in, so completion context doesn't leak across `;`.
// Falls through to the end of the preceding statement when the cursor is in a fresh/empty region.
export function currentStatementStart(statements: SqlStatement[], offset: number): number {
  let start = 0;
  for (const s of statements) {
    if (s.start > offset) break;
    if (offset < s.end) {
      start = s.start; // cursor strictly inside this statement
    } else {
      // At the boundary (offset === s.end): a `;`-terminated statement hands off to a fresh region,
      // but an unterminated trailing statement (e.g. typing `SELECT * FROM `) is still being edited.
      start = s.text.endsWith(';') ? s.end : s.start;
    }
  }
  return start;
}

// [start, end) of the statement the cursor sits in, so completion context can't leak across `;`. In a
// fresh region after a terminator, it extends to the next statement boundary (or textLength).
export function currentStatementRange(
  statements: SqlStatement[],
  offset: number,
  textLength: number,
): { start: number; end: number } {
  const start = currentStatementStart(statements, offset);
  const containing = findStatementAtOffset(statements, offset);
  if (containing) {
    return { start, end: containing.end };
  }
  const next = statements.find((s) => s.start >= offset);
  return { start, end: next ? next.start : textLength };
}
