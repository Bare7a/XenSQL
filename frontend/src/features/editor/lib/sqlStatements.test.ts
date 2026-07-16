import { describe, expect, it } from 'vitest';
import {
  currentStatementRange,
  currentStatementStart,
  findStatementAtOffset,
  findStatementAtRunLine,
  parseSqlStatements,
} from '@/features/editor/lib/sqlStatements';

describe('parseSqlStatements', () => {
  it('returns one statement per semicolon-separated chunk', () => {
    const out = parseSqlStatements('SELECT 1; SELECT 2; SELECT 3');
    expect(out.map((s) => s.text)).toEqual(['SELECT 1;', 'SELECT 2;', 'SELECT 3']);
  });

  it('records the 1-based run line of each statement', () => {
    // runLine is the first non-whitespace char, including leading -- comments which count as content.
    const sql = 'SELECT 1;\n\n  SELECT 2;\n   SELECT 3';
    const out = parseSqlStatements(sql);
    expect(out.map((s) => s.runLine)).toEqual([1, 3, 4]);
  });

  it('does not split on semicolons inside single-quoted strings', () => {
    const out = parseSqlStatements(`SELECT ';not;a;split;';`);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe(`SELECT ';not;a;split;';`);
  });

  it('handles doubled single quote inside a string', () => {
    const out = parseSqlStatements(`SELECT 'O''Reilly;'; SELECT 2`);
    expect(out).toHaveLength(2);
  });

  it('ignores semicolons in double-quoted identifiers and backticks', () => {
    expect(parseSqlStatements(`SELECT 1 FROM "weird;name"; SELECT 2`)).toHaveLength(2);
    expect(parseSqlStatements('SELECT 1 FROM `a;b`; SELECT 2')).toHaveLength(2);
  });

  it('ignores semicolons inside -- line comments', () => {
    expect(parseSqlStatements('SELECT 1 -- ; ignore\n; SELECT 2')).toHaveLength(2);
  });

  it('ignores semicolons inside /* block */ comments', () => {
    expect(parseSqlStatements('SELECT 1 /* ; ignore ; */; SELECT 2')).toHaveLength(2);
  });

  it('respects PostgreSQL dollar-quoted strings', () => {
    const out = parseSqlStatements(`DO $$ BEGIN PERFORM 1; END $$;\nSELECT 1`);
    expect(out).toHaveLength(2);
    expect(out[0].text.startsWith('DO $$')).toBe(true);
  });

  it('respects tagged dollar quotes', () => {
    const out = parseSqlStatements(`DO $tag$ ; ; ; $tag$;\nSELECT 1`);
    expect(out).toHaveLength(2);
  });

  it('does not treat $1$ (a placeholder followed by $) as a dollar-quote delimiter', () => {
    // Regression: an all-digit tag was accepted, so `$1$ … $2$` swallowed everything between as a string.
    expect(parseSqlStatements('SELECT $1$; SELECT 2')).toHaveLength(2);
  });

  it('keeps lone semicolons but drops whitespace-only chunks', () => {
    // Bare `;` trims to ";" and is kept; whitespace-only chunks trim to empty and are dropped.
    expect(parseSqlStatements('   \n   ')).toHaveLength(0);
    expect(parseSqlStatements('SELECT 1;;\nSELECT 2').map((s) => s.text)).toEqual(['SELECT 1;', ';', 'SELECT 2']);
  });

  it('keeps a trailing statement without semicolon', () => {
    const out = parseSqlStatements('SELECT 1');
    expect(out).toEqual([{ text: 'SELECT 1', runLine: 1, start: 0, end: 8 }]);
  });

  it('tracks run lines across many statements (incremental line counting)', () => {
    const sql = Array.from({ length: 50 }, (_, i) => `SELECT ${i};`).join('\n');
    const out = parseSqlStatements(sql);
    expect(out.map((s) => s.runLine)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
});

describe('parseSqlStatements dialects', () => {
  it("mysql: backslash-escaped quote ('it\\'s') does not end the string", () => {
    const sql = String.raw`SELECT 'it\'s a; test'; SELECT 2`;
    expect(parseSqlStatements(sql, 'mysql')).toHaveLength(2);
  });

  it('mysql: # starts a line comment', () => {
    expect(parseSqlStatements('SELECT 1 # ; not a split\n; SELECT 2', 'mysql')).toHaveLength(2);
    // ...but not for postgres, where # is an operator.
    expect(parseSqlStatements("SELECT x # y FROM t; SELECT ';'", 'postgres')).toHaveLength(2);
  });

  it('mysql: $ is an identifier character, not a dollar quote', () => {
    expect(parseSqlStatements('SELECT a$tag$ FROM t; SELECT b$tag$ FROM u', 'mysql')).toHaveLength(2);
  });

  it('postgres: block comments nest', () => {
    const sql = '/* outer /* inner */ ; still comment */ SELECT 1';
    expect(parseSqlStatements(sql, 'postgres')).toHaveLength(1);
    expect(parseSqlStatements(sql, 'postgres')[0].text).toContain('SELECT 1');
  });

  it("postgres: E'...' honors backslash escapes", () => {
    const sql = String.raw`SELECT E'a\'b; not a split'; SELECT 2`;
    expect(parseSqlStatements(sql, 'postgres')).toHaveLength(2);
    expect(parseSqlStatements(sql)).toHaveLength(2); // E-prefix is unambiguous in every dialect
  });

  it("sqlite/default: backslash is a plain character ('a\\' closes the string)", () => {
    const sql = String.raw`SELECT 'path\'; SELECT 2`;
    expect(parseSqlStatements(sql, 'sqlite')).toHaveLength(2);
  });
});

describe('mysql DELIMITER support', () => {
  const proc = [
    'DELIMITER //',
    'CREATE PROCEDURE p()',
    'BEGIN',
    '  SELECT 1;',
    '  SELECT 2;',
    'END//',
    'DELIMITER ;',
    'SELECT 3;',
  ].join('\n');

  it('does not split on ; inside the procedure body and strips the custom terminator', () => {
    const out = parseSqlStatements(proc, 'mysql');
    expect(out.map((s) => s.text)).toEqual(['CREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND', 'SELECT 3;']);
  });

  it('places run glyphs on the real statements, not the DELIMITER lines', () => {
    expect(parseSqlStatements(proc, 'mysql').map((s) => s.runLine)).toEqual([2, 8]);
  });

  it('supports $$ as a custom delimiter', () => {
    const sql = 'DELIMITER $$\nCREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW BEGIN SET @a = 1; END$$\nDELIMITER ;';
    const out = parseSqlStatements(sql, 'mysql');
    expect(out).toHaveLength(1);
    expect(out[0].text.endsWith('END')).toBe(true);
  });

  it('requires DELIMITER at the start of a line', () => {
    expect(parseSqlStatements('SELECT delimiter FROM t; SELECT 2', 'mysql')).toHaveLength(2);
  });

  it('does not treat DELIMITER as a client command on other drivers', () => {
    // Without client delimiters the body semicolons split as usual.
    expect(parseSqlStatements(proc, 'postgres').length).toBeGreaterThan(2);
  });
});

describe('findStatementAtRunLine', () => {
  it('locates the statement starting at the given line', () => {
    const statements = parseSqlStatements('SELECT 1;\n\nSELECT 2');
    expect(findStatementAtRunLine(statements, 3)?.text).toBe('SELECT 2');
  });
  it('returns undefined when no statement starts on that line', () => {
    const statements = parseSqlStatements('SELECT 1;');
    expect(findStatementAtRunLine(statements, 9)).toBeUndefined();
  });
});

describe('currentStatementStart', () => {
  const sql = 'SELECT 1;\nSELECT 2'; // stmt1 [0,9), stmt2 [9,18)
  const statements = parseSqlStatements(sql);

  it('returns the start of the statement the cursor is in', () => {
    expect(currentStatementStart(statements, 5)).toBe(0); // inside SELECT 1
    expect(currentStatementStart(statements, 12)).toBe(9); // inside SELECT 2
  });

  it('returns the end of the previous statement for a fresh trailing region', () => {
    const trailing = parseSqlStatements('SELECT 1;\n'); // only one statement, ends at 9
    expect(currentStatementStart(trailing, 10)).toBe(9);
  });

  it('treats the cursor at the end of an unterminated statement as inside it', () => {
    // Regression: returning the statement end here emptied the completion context (no tables suggested).
    const sql = 'SELECT * FROM ';
    expect(currentStatementStart(parseSqlStatements(sql), sql.length)).toBe(0);
  });

  it('treats the cursor just past a terminator as a fresh statement', () => {
    const sql = 'SELECT 1;';
    expect(currentStatementStart(parseSqlStatements(sql), sql.length)).toBe(sql.length);
  });
});

describe('currentStatementRange', () => {
  it('bounds the range to the statement the cursor is in', () => {
    const sql = 'SELECT 1;\nSELECT 2'; // stmt1 [0,9), stmt2 [9,18)
    const statements = parseSqlStatements(sql);
    expect(currentStatementRange(statements, 5, sql.length)).toEqual({ start: 0, end: 9 });
    expect(currentStatementRange(statements, 12, sql.length)).toEqual({ start: 9, end: 18 });
  });

  it('scopes a later statement so an earlier FROM cannot leak in', () => {
    // Regression: completion parsed the whole document, so this WHERE/FROM saw `users` columns/tables.
    const sql = 'SELECT * FROM users;\nSELECT * FROM ';
    const statements = parseSqlStatements(sql);
    const { start, end } = currentStatementRange(statements, sql.length, sql.length);
    const scoped = sql.slice(start, end);
    expect(scoped).not.toContain('users');
    expect(scoped).toContain('SELECT * FROM');
  });
});

describe('findStatementAtOffset', () => {
  it('locates the statement whose range contains the offset', () => {
    const statements = parseSqlStatements('SELECT 1; SELECT 2');
    expect(findStatementAtOffset(statements, 3)?.text).toBe('SELECT 1;');
    expect(findStatementAtOffset(statements, 14)?.text).toBe('SELECT 2');
  });
});
