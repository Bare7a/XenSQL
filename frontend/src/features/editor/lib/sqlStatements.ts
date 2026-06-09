export interface SqlStatement {
  text: string; // includes trailing semicolon when present
  runLine: number; // 1-based line of the first non-whitespace character (used for the run glyph)
  start: number; // offset of the statement's slice start in the source (contiguous with the previous end)
  end: number; // offset just past the statement (exclusive)
}

function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

const WHITESPACE_RE = /\s/;

function skipLineComment(text: string, i: number, end: number): number {
  i += 2;
  while (i < end && text[i] !== '\n') i++;
  return i;
}

function skipBlockComment(text: string, i: number, end: number): number {
  i += 2;
  while (i < end - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
  return Math.min(i + 2, end);
}

// doubleEscape: '' / "" are embedded quotes (SQL convention); backticks don't double-escape.
function skipQuoted(text: string, i: number, quote: string, doubleEscape: boolean, end: number): number {
  i++;
  while (i < end) {
    if (text[i] === quote) {
      if (doubleEscape && text[i + 1] === quote) {
        i += 2;
        continue;
      }
      i++;
      return i;
    }
    i++;
  }
  return i;
}

function skipDollarQuoted(text: string, i: number, end: number): number {
  // Tags never start with a digit, so `$1$` is a placeholder between two `$`, not a quote delimiter.
  const tagMatch = text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  if (!tagMatch) return i + 1;
  const tag = tagMatch[0];
  i += tag.length;
  const close = text.indexOf(tag, i);
  return close === -1 ? end : close + tag.length;
}

function firstCodeOffset(text: string, from: number, to: number): number {
  let i = from;
  while (i < to) {
    const ch = text[i];
    if (ch === undefined) break;
    if (WHITESPACE_RE.test(ch)) {
      i++;
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      i = skipLineComment(text, i, to);
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i = skipBlockComment(text, i, to);
      continue;
    }
    return i;
  }
  return -1;
}

export function parseSqlStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  const len = sql.length;
  let stmtStart = 0;
  let i = 0;

  const pushStatement = (endExclusive: number, includeSemicolon: boolean) => {
    const sliceEnd = includeSemicolon ? endExclusive + 1 : endExclusive;
    const start = stmtStart;
    const raw = sql.slice(start, sliceEnd);
    const text = raw.trim();
    if (!text) {
      stmtStart = sliceEnd;
      return;
    }
    const codeAt = firstCodeOffset(sql, start, sliceEnd);
    if (codeAt < 0) {
      stmtStart = sliceEnd;
      return;
    }
    statements.push({ text, runLine: lineColumnAt(sql, codeAt).line, start, end: sliceEnd });
    stmtStart = sliceEnd;
  };

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      i = skipLineComment(sql, i, len);
      continue;
    }
    if (ch === '/' && next === '*') {
      i = skipBlockComment(sql, i, len);
      continue;
    }
    if (ch === "'") {
      i = skipQuoted(sql, i, "'", true, len);
      continue;
    }
    if (ch === '"') {
      i = skipQuoted(sql, i, '"', true, len);
      continue;
    }
    if (ch === '`') {
      i = skipQuoted(sql, i, '`', false, len);
      continue;
    }
    if (ch === '$') {
      i = skipDollarQuoted(sql, i, len);
      continue;
    }
    if (ch === ';') {
      pushStatement(i, true);
      i++;
      continue;
    }

    i++;
  }

  const trailing = sql.slice(stmtStart).trim();
  if (trailing) {
    const codeAt = firstCodeOffset(sql, stmtStart, len);
    if (codeAt >= 0) {
      statements.push({ text: trailing, runLine: lineColumnAt(sql, codeAt).line, start: stmtStart, end: len });
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
