import { describe, expect, it } from 'vitest';
import {
  bindingsNeedingColumns,
  buildCompletionItems,
  completionReplaceRange,
} from '@/features/editor/lib/sqlCompletion';
import { analyzeSqlCursor } from '@/features/editor/lib/sqlContext';
import { parseQueryContext } from '@/features/editor/lib/sqlQueryParse';
import { columnCacheKey, identifierNeedsQuote } from '@/features/editor/lib/sqlQuoting';
import { currentStatementStart, parseSqlStatements } from '@/features/editor/lib/sqlStatements';
import type { CompletionContext } from '@/features/editor/lib/sqlSuggestions';
import type { ColumnInfo, DriverType, SchemaInfo, TableInfo } from '@/types';

const schemas: SchemaInfo[] = [{ name: 'public' }];
const tables: TableInfo[] = [
  { schema: 'public', name: 'users', type: 'table' },
  { schema: 'public', name: 'orders', type: 'table' },
];
const userColumns: ColumnInfo[] = [
  { name: 'id', dataType: 'int', isNullable: false, isPrimary: true, isForeign: false },
  { name: 'email', dataType: 'text', isNullable: false, isPrimary: false, isForeign: false },
  { name: 'name', dataType: 'text', isNullable: true, isPrimary: false, isForeign: false },
];

function makeCtx(driver: DriverType = 'postgres'): CompletionContext {
  return {
    schemas,
    tables,
    columns: [],
    tablesBySchema: { public: tables },
    columnsByTable: { 'public.users': userColumns },
    driver,
  };
}

function complete(text: string, driver: DriverType = 'postgres') {
  const parsed = parseQueryContext(text, tables, schemas, driver);
  return buildCompletionItems({ ctx: makeCtx(driver), text, position: text.length, parsed });
}

const labelsOf = (text: string, driver?: DriverType) => complete(text, driver).map((i) => i.label);
const columnLabels = (text: string, driver?: DriverType) =>
  labelsOf(text, driver).filter((l) => ['id', 'email', 'name'].includes(l));
const insertFor = (text: string, label: string) => complete(text).find((i) => i.label === label)?.insertText;

const ALL_COLS = ['id', 'email', 'name'];

// These exact strings previously returned an empty list.
describe('columns appear right after a clause keyword (no trailing space)', () => {
  const cases = [
    'SELECT * FROM users AS "Users" WHERE',
    'SELECT * FROM "Users" WHERE',
    'SELECT * FROM users "U" WHERE',
    'SELECT * FROM users ORDER BY',
    'SELECT * FROM "Users" ORDER BY',
  ];

  for (const sql of cases) {
    it(`suggests every column for ${JSON.stringify(sql)}`, () => {
      expect(columnLabels(sql)).toEqual(expect.arrayContaining(ALL_COLS));
    });

    it(`inserts space-prefixed so it reads cleanly for ${JSON.stringify(sql)}`, () => {
      // The caret butts against the keyword, so the insert must add the space.
      expect(insertFor(sql, 'email')).toBe(' email');
    });

    it(`replaces nothing (zero-width range) for ${JSON.stringify(sql)}`, () => {
      const col = sql.length + 1;
      const range = completionReplaceRange({ lineNumber: 1, column: col }, sql, {
        startColumn: col,
        endColumn: col,
      });
      expect(range.startColumn).toBe(range.endColumn);
    });
  }

  it('also covers HAVING, FROM and UPDATE … SET', () => {
    const slot = (sql: string) => analyzeSqlCursor(sql, 'postgres').slot;
    expect(slot('SELECT * FROM users GROUP BY x HAVING').kind).toBe('filter-start');
    expect(slot('SELECT * FROM')).toMatchObject({ kind: 'table', leadingSpace: true });
    expect(slot('SELECT * FROM users JOIN')).toMatchObject({ kind: 'table', leadingSpace: true });
    expect(slot('UPDATE users SET')).toMatchObject({ kind: 'set-column', leadingSpace: true });
  });

  it('does not mistake identifiers ending in a keyword for the keyword', () => {
    // `brand`/`elsewhere`/`person` end in AND/WHERE/ON but are not keywords.
    const slot = (sql: string) => analyzeSqlCursor(sql, 'postgres').slot;
    expect(slot('SELECT brand').kind).toBe('general');
    expect(slot('SELECT elsewhere').kind).toBe('general');
    // A partial table name after FROM is a prefix filter, never a butted clause keyword.
    expect(slot('SELECT * FROM person')).toMatchObject({ kind: 'table', prefix: 'person', leadingSpace: false });
  });
});

describe('ORDER BY / GROUP BY suggest columns', () => {
  for (const sql of [
    'SELECT * FROM users ORDER BY ',
    'SELECT * FROM "Users" ORDER BY ',
    'SELECT * FROM users GROUP BY ',
  ]) {
    it(`suggests columns for ${JSON.stringify(sql)}`, () => {
      expect(columnLabels(sql)).toEqual(expect.arrayContaining(ALL_COLS));
    });
    it(`does not space-prefix when a separator is present: ${JSON.stringify(sql)}`, () => {
      expect(insertFor(sql, 'email')).toBe('email');
    });
  }

  it('offers ASC / DESC only after a column in ORDER BY', () => {
    // At the start of the clause, a column is expected - not a direction.
    expect(labelsOf('SELECT * FROM users ORDER BY ')).not.toEqual(expect.arrayContaining(['ASC', 'DESC']));
    // Once a column is present, the direction keywords appear.
    expect(labelsOf('SELECT * FROM users ORDER BY name ')).toEqual(expect.arrayContaining(['ASC', 'DESC']));
    // GROUP BY never takes a sort direction.
    expect(labelsOf('SELECT * FROM users GROUP BY name ')).not.toEqual(expect.arrayContaining(['ASC', 'DESC']));
  });

  it('filters by a partially typed column', () => {
    expect(columnLabels('SELECT * FROM "Users" ORDER BY na')).toEqual(['name']);
  });

  it('resolves an alias qualifier (alias.<col>) inside ORDER BY', () => {
    expect(columnLabels('SELECT * FROM users "U" ORDER BY U.')).toEqual(expect.arrayContaining(ALL_COLS));
  });

  it('stops once a terminating clause follows the BY list', () => {
    expect(analyzeSqlCursor('SELECT * FROM users GROUP BY id HAVING ', 'postgres').slot.kind).not.toBe('order-group');
    expect(analyzeSqlCursor('SELECT * FROM users ORDER BY id LIMIT ', 'postgres').slot.kind).toBe('limit');
  });
});

describe('inserts respect driver quoting', () => {
  it('quotes a mixed-case column for mysql with backticks', () => {
    const ctx = makeCtx('mysql');
    ctx.columnsByTable['public.users'] = [
      { name: 'First Name', dataType: 'text', isNullable: true, isPrimary: false, isForeign: false },
    ];
    const parsed = parseQueryContext('SELECT * FROM users WHERE ', tables, schemas, 'mysql');
    const items = buildCompletionItems({
      ctx,
      text: 'SELECT * FROM users WHERE ',
      position: 'SELECT * FROM users WHERE '.length,
      parsed,
    });
    expect(items.find((i) => i.label === 'First Name')?.insertText).toBe('`First Name`');
  });
});

describe('existing contexts are unchanged', () => {
  it('suggests tables after FROM <prefix>', () => {
    expect(labelsOf('SELECT * FROM us')).toEqual(expect.arrayContaining(['users']));
  });

  it('suggests value columns after a comparison operator', () => {
    expect(columnLabels('SELECT * FROM users WHERE id = ')).toEqual(expect.arrayContaining(ALL_COLS));
    expect(analyzeSqlCursor('SELECT * FROM users WHERE id =', 'postgres').slot.kind).toBe('value');
  });

  it('suggests columns in UPDATE … SET', () => {
    expect(columnLabels('UPDATE users SET ')).toEqual(expect.arrayContaining(ALL_COLS));
  });

  it('after a completed SET assignment offers WHERE and columns again after a comma', () => {
    expect(columnLabels('UPDATE users SET name = 1 ')).toEqual([]);
    expect(labelsOf('UPDATE users SET name = 1 ')).toContain('WHERE');
    expect(columnLabels('UPDATE users SET name = 1, ')).toEqual(expect.arrayContaining(ALL_COLS));
  });

  it('resolves dotted alias columns in WHERE', () => {
    expect(columnLabels('SELECT * FROM users AS "Users" WHERE "Users".')).toEqual(expect.arrayContaining(ALL_COLS));
  });

  it('still offers the keyword list mid-statement', () => {
    expect(labelsOf('SELECT * FROM users ')).toEqual(expect.arrayContaining(['WHERE', 'JOIN']));
  });
});

// Regression: a quoted table in FROM (`FROM "Users"`) broke WHERE completion - the range matched
// from its closing quote (hiding everything) and the table-ref needs a quoted filterText to match.
describe('capital/quoted table works in WHERE (range + filterText)', () => {
  const capTables: TableInfo[] = [{ schema: 'public', name: 'Users', type: 'table' }];
  const capCtx = (): CompletionContext => ({
    schemas,
    tables: capTables,
    columns: [],
    tablesBySchema: { public: capTables },
    columnsByTable: { 'public.Users': userColumns },
    driver: 'postgres',
  });
  const capItems = (text: string) =>
    buildCompletionItems({
      ctx: capCtx(),
      text,
      position: text.length,
      parsed: parseQueryContext(text, capTables, schemas, 'postgres'),
    });
  // clauseBodyStart space-prefixes the insert, so match on the trimmed value.
  const userRef = (text: string) => capItems(text).find((i) => i.kind === 'class' && i.insertText.trim() === '"Users"');

  // The substring completionReplaceRange would overwrite for a single-line statement.
  const replaced = (text: string) => {
    const range = completionReplaceRange({ lineNumber: 1, column: text.length + 1 }, text, {
      startColumn: text.length + 1,
      endColumn: text.length + 1,
    });
    return text.slice(range.startColumn - 1, range.endColumn - 1);
  };

  it('FROM and WHERE both label the table bare with a quoted filterText', () => {
    for (const sql of ['SELECT * FROM ', 'SELECT * FROM "Users" WHERE', 'SELECT * FROM "Users" WHERE Us']) {
      const ref = userRef(sql);
      expect(ref?.label).toBe('Users');
      expect(ref?.insertText.trim()).toBe('"Users"');
      // Quoted filterText: typing the opening `"` must still match the suggestion.
      expect(ref?.filterText).toBe('"Users"');
    }
  });

  it('does NOT overwrite back across the closing quote of an earlier "Users"', () => {
    // The bug: range spanned from the closing `"` → `" WHERE ` (8 chars) → hid everything.
    expect(replaced('SELECT * FROM "Users" WHERE ')).toBe('');
    expect(replaced('SELECT * FROM "Users" WHERE e')).toBe('e');
    expect(replaced('SELECT * FROM "Users" WHERE Us')).toBe('Us');
    // An actually-open quote is still captured so it gets replaced (not duplicated) on accept.
    expect(replaced('SELECT * FROM "Users" WHERE "Us')).toBe('"Us');
  });
});

// Regression: FROM a JOIN b swallowed JOIN as a's alias so b columns never resolved.
describe('statement-scoped completion still suggests tables (editor wiring)', () => {
  // Mirrors SqlEditor: scope the buffer to the current statement, then complete.
  const scopedLabels = (text: string, offset = text.length) => {
    const statementStart = currentStatementStart(parseSqlStatements(text), offset);
    const parsed = parseQueryContext(text, tables, schemas, 'postgres');
    return buildCompletionItems({
      ctx: makeCtx(),
      text,
      position: offset,
      parsed,
      statementStart,
    }).map((i) => i.label);
  };

  it('suggests tables at the end of FROM in an unterminated statement', () => {
    // Regression: statement scoping emptied the context here, so no tables were suggested.
    expect(scopedLabels('SELECT * FROM ')).toEqual(expect.arrayContaining(['users', 'orders']));
  });

  it('suggests tables in a second statement after a terminated one', () => {
    expect(scopedLabels('SELECT 1;\nSELECT * FROM ')).toEqual(expect.arrayContaining(['users', 'orders']));
  });
});

describe('schema-qualified table completion', () => {
  it("lists a schema's tables right after the dot (FROM public.)", () => {
    // Regression: a dangling `schema.` registered a bogus table binding and returned an empty list.
    expect(labelsOf('SELECT * FROM public.')).toEqual(expect.arrayContaining(['users', 'orders']));
  });
});

describe('identifierNeedsQuote quotes reserved words', () => {
  it('quotes a column literally named after a keyword', () => {
    expect(identifierNeedsQuote('order', 'postgres')).toBe(true);
    expect(identifierNeedsQuote('select', 'mysql')).toBe(true);
    expect(identifierNeedsQuote('user', 'sqlite')).toBe(true);
  });
  it('leaves ordinary identifiers unquoted', () => {
    expect(identifierNeedsQuote('email', 'postgres')).toBe(false);
    expect(identifierNeedsQuote('created_at', 'postgres')).toBe(false);
  });
});

describe('JOIN target tables resolve', () => {
  const joinTables: TableInfo[] = [
    { schema: 'public', name: 'accounts', type: 'table' },
    { schema: 'public', name: 'contracts', type: 'table' },
  ];
  const colsByTable: Record<string, ColumnInfo[]> = {
    'public.accounts': [{ name: 'id', dataType: 'int', isNullable: false, isPrimary: true, isForeign: false }],
    'public.contracts': [
      { name: 'id', dataType: 'int', isNullable: false, isPrimary: true, isForeign: false },
      { name: 'account_id', dataType: 'int', isNullable: false, isPrimary: false, isForeign: false },
      { name: 'amount', dataType: 'numeric', isNullable: true, isPrimary: false, isForeign: false },
    ],
  };

  function appComplete(text: string) {
    const parsed = parseQueryContext(text, joinTables, schemas, 'postgres');
    const columnsByTable: Record<string, ColumnInfo[]> = {};
    for (const ref of bindingsNeedingColumns(text, parsed, {
      tables: joinTables,
      schemas,
      driver: 'postgres',
    })) {
      const key = columnCacheKey(ref.schema, ref.table);
      columnsByTable[key] = colsByTable[key] ?? [];
    }
    const ctx: CompletionContext = {
      schemas,
      tables: joinTables,
      columns: [],
      tablesBySchema: { public: joinTables },
      columnsByTable,
      driver: 'postgres',
    };
    return buildCompletionItems({ ctx, text, position: text.length, parsed }).map((i) => i.label);
  }

  it('parses both tables in FROM a JOIN b', () => {
    const parsed = parseQueryContext('SELECT * FROM accounts JOIN contracts ON ', joinTables, schemas, 'postgres');
    expect(parsed.queryTables.map((t) => t.table)).toEqual(['accounts', 'contracts']);
  });

  it('suggests the joined table’s columns for contracts. (the reported case)', () => {
    const text = 'SELECT * FROM accounts \nJOIN contracts ON \naccounts.id = contracts.';
    expect(appComplete(text)).toEqual(['id', 'account_id', 'amount']);
  });

  it('resolves contracts. in the ON clause without an = operator', () => {
    expect(appComplete('SELECT * FROM accounts JOIN contracts ON contracts.')).toEqual(['id', 'account_id', 'amount']);
  });

  it('resolves an aliased joined table (c.)', () => {
    expect(appComplete('SELECT * FROM accounts a JOIN contracts c ON c.')).toEqual(['id', 'account_id', 'amount']);
  });

  it('keeps a quoted reserved-word alias working (AS "join")', () => {
    const parsed = parseQueryContext('SELECT * FROM accounts AS "join" WHERE ', joinTables, schemas, 'postgres');
    expect(parsed.queryTables.map((t) => t.table)).toEqual(['accounts']);
  });

  it('offers the in-scope table-refs after a comparison operator (= <value>)', () => {
    // The RHS of `=` is often another qualified column, so the tables must be offered too.
    expect(appComplete('SELECT * FROM accounts JOIN contracts ON accounts.id = ')).toEqual(
      expect.arrayContaining(['accounts', 'contracts']),
    );
  });
});

// Regression (reported): on the RHS of `=` joining two quoted tables, neither the other table nor
// its column was offered. The table-ref (bare label + quoted filterText) must be there.
describe('value context after = offers the joined capital table-ref + column', () => {
  const capTables: TableInfo[] = [
    { schema: 'public', name: 'Users', type: 'table' },
    { schema: 'public', name: 'EBayAccounts', type: 'table' },
  ];
  const cols: Record<string, ColumnInfo[]> = {
    'public.Users': [{ name: 'id', dataType: 'int', isNullable: false, isPrimary: true, isForeign: false }],
    'public.EBayAccounts': [
      { name: 'id', dataType: 'int', isNullable: false, isPrimary: true, isForeign: false },
      { name: 'userId', dataType: 'int', isNullable: false, isPrimary: false, isForeign: false },
    ],
  };
  const complete = (text: string) => {
    const parsed = parseQueryContext(text, capTables, schemas, 'postgres');
    const columnsByTable: Record<string, ColumnInfo[]> = {};
    for (const ref of bindingsNeedingColumns(text, parsed, { tables: capTables, schemas, driver: 'postgres' })) {
      const key = columnCacheKey(ref.schema, ref.table);
      columnsByTable[key] = cols[key] ?? [];
    }
    const ctx: CompletionContext = {
      schemas,
      tables: capTables,
      columns: [],
      tablesBySchema: { public: capTables },
      columnsByTable,
      driver: 'postgres',
    };
    return buildCompletionItems({ ctx, text, position: text.length, parsed });
  };

  const base = 'SELECT * FROM "Users" JOIN "EBayAccounts" ON "Users".id = ';

  it('offers both table-refs and the wanted column on the RHS', () => {
    const labels = complete(base).map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['Users', 'EBayAccounts', 'userId']));
  });

  it('the capital table-ref has a bare label and a quoted filterText (so typing `E`/`"E` matches)', () => {
    const ref = complete(base).find((i) => i.kind === 'class' && i.insertText.trim() === '"EBayAccounts"');
    expect(ref?.label).toBe('EBayAccounts');
    expect(ref?.filterText).toBe('"EBayAccounts"');
  });

  it('a qualified RHS resolves the table’s columns ("EBayAccounts".)', () => {
    const labels = complete(`${base}"EBayAccounts".`).map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['userId']));
  });
});

// Regression (reported): the LIMIT/OFFSET tail dumped the whole keyword list (and word-based
// tokens), wrongly offering columns/tables. It takes a number, then optionally OFFSET.
describe('LIMIT / OFFSET clause suggestions', () => {
  it('offers nothing after LIMIT (a numeric literal is expected)', () => {
    expect(labelsOf('SELECT * FROM users LIMIT ')).toEqual([]);
  });

  it('offers only OFFSET after LIMIT <n>', () => {
    expect(labelsOf('SELECT * FROM users LIMIT 100 ')).toEqual(['OFFSET']);
  });

  it('offers nothing in the OFFSET value slot or after it', () => {
    expect(labelsOf('SELECT * FROM users LIMIT 100 OFFSET ')).toEqual([]);
    expect(labelsOf('SELECT * FROM users LIMIT 100 OFFSET 5 ')).toEqual([]);
  });

  it('does not leak columns/tables/clause keywords into the LIMIT tail', () => {
    for (const sql of ['SELECT * FROM users LIMIT ', 'SELECT * FROM users LIMIT 100 ']) {
      expect(labelsOf(sql)).not.toEqual(expect.arrayContaining(['users', 'id', 'email', 'WHERE', 'JOIN']));
    }
  });

  it('still offers LIMIT as a keyword mid-statement and while typing it', () => {
    expect(labelsOf('SELECT * FROM users ')).toEqual(expect.arrayContaining(['LIMIT']));
    expect(labelsOf('SELECT * FROM users LIMI')).toEqual(expect.arrayContaining(['LIMIT']));
  });

  it('leaves the ORDER BY tail (ASC/DESC + columns) unchanged', () => {
    expect(labelsOf('SELECT * FROM users ORDER BY id ')).toEqual(expect.arrayContaining(['ASC', 'DESC']));
  });
});

// Snippets (aggregate COUNT(…)/SUM(…)/…, the JOIN … ON template, the FROM … template) were
// removed from completion - these contexts used to surface them.
describe('snippet suggestions are gone', () => {
  for (const sql of [
    'SELECT ',
    'SELECT * FROM users WHERE ',
    'SELECT * FROM users ORDER BY id ',
    'SELECT * FROM users ',
  ]) {
    it(`offers no snippet items for ${JSON.stringify(sql)}`, () => {
      const labels = labelsOf(sql);
      const snippetLike = labels.filter((l) => l.includes('(…)') || l.includes('… ON') || l.startsWith('FROM …'));
      expect(snippetLike).toEqual([]);
    });
  }
});

// Reported: hitting space after a finished term (e.g. `ORDER BY col DESC`) kept offering
// columns/tables. They should follow only an identifier-expecting token, not a completed one.
describe('column/table suggestions only follow an identifier-expecting token', () => {
  it('offers columns right after a trigger token', () => {
    expect(columnLabels('SELECT * FROM users WHERE ')).toEqual(expect.arrayContaining(ALL_COLS));
    expect(columnLabels('SELECT * FROM users WHERE id = 1 AND ')).toEqual(expect.arrayContaining(ALL_COLS));
    expect(columnLabels('SELECT * FROM users WHERE id = 1 OR ')).toEqual(expect.arrayContaining(ALL_COLS));
    expect(columnLabels('SELECT * FROM users WHERE id >= ')).toEqual(expect.arrayContaining(ALL_COLS));
    expect(columnLabels('SELECT * FROM users ORDER BY ')).toEqual(expect.arrayContaining(ALL_COLS));
  });

  it('offers no columns/tables after a completed column, value, or direction', () => {
    expect(columnLabels('SELECT * FROM users WHERE id ')).toEqual([]);
    expect(columnLabels('SELECT * FROM users WHERE id = 5 ')).toEqual([]);
    expect(columnLabels('SELECT * FROM users ORDER BY id ')).toEqual([]);
    expect(columnLabels('SELECT * FROM users ORDER BY id DESC ')).toEqual([]);
  });

  it('offers no columns/tables after ORDER BY <col> DESC, only trailing clauses (the reported case)', () => {
    expect(columnLabels('SELECT * FROM users ORDER BY id DESC ')).toEqual([]);
    expect(labelsOf('SELECT * FROM users ORDER BY id DESC ')).toEqual(['LIMIT', 'OFFSET']);
  });

  it('still offers operators (not columns) after a completed column in WHERE', () => {
    expect(labelsOf('SELECT * FROM users WHERE id ')).toEqual(expect.arrayContaining(['AND', 'OR']));
  });

  it('offers ASC/DESC + trailing clauses after a sort column, no second direction after DESC', () => {
    expect(labelsOf('SELECT * FROM users ORDER BY id ')).toEqual(['ASC', 'DESC', 'LIMIT', 'OFFSET']);
    expect(labelsOf('SELECT * FROM users ORDER BY id DESC ')).toEqual(['LIMIT', 'OFFSET']);
  });
});

describe('comma-joined FROM tables (FROM a, b)', () => {
  it('parses every table in the comma list', () => {
    const parsed = parseQueryContext('SELECT * FROM users, orders WHERE ', tables, schemas, 'postgres');
    expect(parsed.queryTables.map((t) => t.table).sort()).toEqual(['orders', 'users']);
  });

  it('does not double-count the first table', () => {
    const parsed = parseQueryContext('SELECT * FROM users, orders', tables, schemas, 'postgres');
    expect(parsed.queryTables.filter((t) => t.table === 'users')).toHaveLength(1);
  });

  it('binds aliases from a comma list (a x, b y)', () => {
    const parsed = parseQueryContext('SELECT * FROM users u, orders o WHERE ', tables, schemas, 'postgres');
    expect(parsed.bindings.get('u')?.table).toBe('users');
    expect(parsed.bindings.get('o')?.table).toBe('orders');
  });

  it('suggests both comma-joined tables as refs in WHERE', () => {
    expect(labelsOf('SELECT * FROM users, orders WHERE ')).toEqual(expect.arrayContaining(['users', 'orders']));
  });

  it('still parses FROM a JOIN b without duplicating a', () => {
    const parsed = parseQueryContext('SELECT * FROM users JOIN orders ON ', tables, schemas, 'postgres');
    expect(parsed.queryTables.map((t) => t.table)).toEqual(['users', 'orders']);
  });
});

describe('CTE names from a leading WITH', () => {
  it('parses a single CTE name', () => {
    const parsed = parseQueryContext('WITH recent AS (SELECT 1) SELECT * FROM ', tables, schemas, 'postgres');
    expect(parsed.ctes).toEqual(['recent']);
  });

  it('parses several comma-separated CTEs', () => {
    const parsed = parseQueryContext(
      'WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM ',
      tables,
      schemas,
      'postgres',
    );
    expect(parsed.ctes).toEqual(['a', 'b']);
  });

  it('does not invent CTEs from AS-aliased columns (no leading WITH)', () => {
    const parsed = parseQueryContext('SELECT a AS x FROM users', tables, schemas, 'postgres');
    expect(parsed.ctes).toEqual([]);
  });

  it('suggests the CTE name in the FROM slot (with and without a prefix)', () => {
    expect(labelsOf('WITH recent AS (SELECT 1) SELECT * FROM ')).toEqual(expect.arrayContaining(['recent']));
    expect(labelsOf('WITH recent AS (SELECT 1) SELECT * FROM rec')).toContain('recent');
  });

  it('keeps the CTE in the FROM list even with a large schema (survives the 100-item slice)', () => {
    // Regression (reported): CTEs were appended after all tables, so with 100+ tables the empty-
    // prefix FROM list sliced the CTE off. They must lead the list now.
    const manyTables: TableInfo[] = Array.from({ length: 150 }, (_, i) => ({
      schema: 'public',
      name: `tbl_${i}`,
      type: 'table',
    }));
    const text = 'WITH asd AS (SELECT * FROM users LIMIT 10) SELECT * FROM ';
    const parsed = parseQueryContext(text, manyTables, schemas, 'postgres');
    const ctx: CompletionContext = {
      schemas,
      tables: manyTables,
      columns: [],
      tablesBySchema: { public: manyTables },
      columnsByTable: {},
      driver: 'postgres',
    };
    const items = buildCompletionItems({ ctx, text, position: text.length, parsed });
    expect(items).toHaveLength(100); // still capped
    expect(items.map((i) => i.label)).toContain('asd');
    expect(items[0].label).toBe('asd'); // and ranked first (tier 0)
  });
});

describe('INSERT INTO column list', () => {
  it('suggests the target table’s columns inside the paren', () => {
    expect(columnLabels('INSERT INTO users (')).toEqual(expect.arrayContaining(ALL_COLS));
    expect(columnLabels('INSERT INTO public.users (')).toEqual(expect.arrayContaining(ALL_COLS));
  });

  it('filters by the typed prefix and omits already-listed columns', () => {
    expect(columnLabels('INSERT INTO users (id, em')).toEqual(['email']);
    expect(columnLabels('INSERT INTO users (id, ')).toEqual(['email', 'name']);
  });

  it('does not offer columns in the VALUES paren', () => {
    expect(columnLabels('INSERT INTO users (id) VALUES (')).toEqual([]);
  });

  it('loads the target table’s columns (bindingsNeedingColumns)', () => {
    const text = 'INSERT INTO users (';
    const parsed = parseQueryContext(text, tables, schemas, 'postgres');
    const needed = bindingsNeedingColumns(text, parsed, { tables, schemas, driver: 'postgres' });
    expect(needed.map((b) => columnCacheKey(b.schema, b.table))).toEqual(['public.users']);
  });
});

describe('no completions inside comments', () => {
  it('offers nothing while typing a line comment', () => {
    expect(labelsOf('SELECT * FROM users -- WHERE ')).toEqual([]);
    expect(labelsOf('SELECT * FROM users -- sel')).toEqual([]);
  });

  it('offers nothing inside an unterminated block comment', () => {
    expect(labelsOf('SELECT * FROM users /* WHERE ')).toEqual([]);
  });

  it('recovers after the comment closes', () => {
    expect(labelsOf('SELECT * FROM users /* note */ ')).toEqual(expect.arrayContaining(['WHERE', 'JOIN']));
  });

  it('requests no column loads while in a comment', () => {
    const text = 'SELECT * FROM users -- WHERE ';
    const parsed = parseQueryContext(text, tables, schemas, 'postgres');
    expect(bindingsNeedingColumns(text, parsed, { tables, schemas, driver: 'postgres' })).toEqual([]);
  });
});

describe('clause detection ignores comment/string contents', () => {
  it('a WHERE inside a comment does not create a filter context', () => {
    expect(columnLabels('SELECT * FROM users /* WHERE */ ')).toEqual([]);
  });

  it('a quoted string containing = does not create a value context', () => {
    expect(labelsOf("SELECT * FROM users WHERE note = 'a = b' ")).toEqual(expect.arrayContaining(['AND', 'OR']));
  });
});

describe('the 100-item cap keeps the best-ranked matches', () => {
  it('a prefix match listed last still survives the cap', () => {
    // 150 substring matches fill the list; the lone prefix match (rank 0) must not be sliced off.
    const manyTables: TableInfo[] = [
      ...Array.from({ length: 150 }, (_, i) => ({ schema: 'public', name: `also_tbl_${i}`, type: 'table' })),
      { schema: 'public', name: 'tbl_exact', type: 'table' },
    ];
    const text = 'SELECT * FROM tbl';
    const ctx: CompletionContext = {
      schemas,
      tables: manyTables,
      columns: [],
      tablesBySchema: { public: manyTables },
      columnsByTable: {},
      driver: 'postgres',
    };
    const items = buildCompletionItems({
      ctx,
      text,
      position: text.length,
      parsed: parseQueryContext(text, manyTables, schemas, 'postgres'),
    });
    expect(items).toHaveLength(100);
    expect(items[0].label).toBe('tbl_exact');
  });
});

describe('filter operators are offered per dialect', () => {
  const whereCol = 'SELECT * FROM users WHERE name ';

  it('offers the negated common operators in WHERE for every driver', () => {
    for (const driver of ['postgres', 'mysql', 'sqlite'] as const) {
      expect(labelsOf(whereCol, driver)).toEqual(expect.arrayContaining(['LIKE', 'NOT LIKE', 'NOT IN', 'NOT BETWEEN']));
    }
  });

  it('offers ILIKE / NOT ILIKE / SIMILAR TO only on postgres', () => {
    expect(labelsOf(whereCol, 'postgres')).toEqual(expect.arrayContaining(['ILIKE', 'NOT ILIKE', 'SIMILAR TO']));
    expect(labelsOf(whereCol, 'mysql')).not.toContain('ILIKE');
    expect(labelsOf(whereCol, 'sqlite')).not.toContain('ILIKE');
  });

  it('offers REGEXP / RLIKE only on mysql and GLOB only on sqlite', () => {
    expect(labelsOf(whereCol, 'mysql')).toEqual(expect.arrayContaining(['REGEXP', 'RLIKE']));
    expect(labelsOf(whereCol, 'postgres')).not.toContain('REGEXP');
    expect(labelsOf(whereCol, 'sqlite')).toEqual(expect.arrayContaining(['GLOB']));
    expect(labelsOf(whereCol, 'postgres')).not.toContain('GLOB');
    expect(labelsOf(whereCol, 'mysql')).not.toContain('GLOB');
  });

  it('matches ILIKE while typing it', () => {
    expect(labelsOf('SELECT * FROM users WHERE name ILI', 'postgres')).toContain('ILIKE');
    expect(labelsOf('SELECT * FROM users WHERE name NOT L', 'postgres')).toContain('NOT LIKE');
  });

  it('offers them in ON and HAVING clauses too', () => {
    expect(labelsOf('SELECT * FROM users u JOIN orders o ON u.id ', 'postgres')).toContain('ILIKE');
    expect(labelsOf('SELECT * FROM users GROUP BY name HAVING name ', 'postgres')).toContain('ILIKE');
  });

  it('does not offer them outside a filter clause', () => {
    expect(labelsOf('SELECT * FROM users ', 'postgres')).not.toContain('ILIKE');
    expect(labelsOf('SELECT * FROM users ', 'postgres')).not.toContain('NOT LIKE');
  });

  it('suggests columns after ILIKE, like after LIKE', () => {
    expect(columnLabels('SELECT * FROM users WHERE name ILIKE ')).toEqual(expect.arrayContaining(ALL_COLS));
    expect(columnLabels('SELECT * FROM users WHERE name SIMILAR TO ')).toEqual(expect.arrayContaining(ALL_COLS));
  });

  it('offers IS [NOT] DISTINCT FROM only on postgres and MATCH only on sqlite', () => {
    expect(labelsOf(whereCol, 'postgres')).toEqual(
      expect.arrayContaining(['IS DISTINCT FROM', 'IS NOT DISTINCT FROM']),
    );
    expect(labelsOf(whereCol, 'mysql')).not.toContain('IS DISTINCT FROM');
    expect(labelsOf(whereCol, 'sqlite')).not.toContain('IS DISTINCT FROM');
    expect(labelsOf(whereCol, 'sqlite')).toEqual(expect.arrayContaining(['MATCH']));
    expect(labelsOf(whereCol, 'postgres')).not.toContain('MATCH');
    expect(labelsOf(whereCol, 'mysql')).not.toContain('MATCH');
  });
});

describe('driver-specific statement keywords', () => {
  it('gates statement starters per driver', () => {
    const pg = labelsOf('', 'postgres');
    expect(pg).toEqual(expect.arrayContaining(['TRUNCATE TABLE', 'VACUUM', 'EXPLAIN']));
    expect(pg).not.toEqual(expect.arrayContaining(['REPLACE INTO', 'PRAGMA', 'SHOW TABLES']));

    const my = labelsOf('', 'mysql');
    expect(my).toEqual(expect.arrayContaining(['TRUNCATE TABLE', 'REPLACE INTO', 'SHOW TABLES', 'SHOW DATABASES']));
    expect(my).not.toEqual(expect.arrayContaining(['PRAGMA', 'VACUUM']));

    const lite = labelsOf('', 'sqlite');
    expect(lite).toEqual(expect.arrayContaining(['PRAGMA', 'VACUUM', 'REPLACE INTO', 'EXPLAIN']));
    expect(lite).not.toEqual(expect.arrayContaining(['TRUNCATE TABLE', 'SHOW TABLES']));
  });

  it('keeps dialect starters out of the middle of a statement', () => {
    expect(labelsOf('SELECT * FROM users ', 'sqlite')).not.toEqual(expect.arrayContaining(['PRAGMA', 'VACUUM']));
    expect(labelsOf('SELECT * FROM users ', 'mysql')).not.toContain('SHOW TABLES');
    expect(labelsOf('SELECT * FROM users ', 'postgres')).not.toContain('EXPLAIN');
  });

  it('offers FULL JOIN everywhere but mysql, CROSS JOIN everywhere', () => {
    expect(labelsOf('SELECT * FROM users ', 'postgres')).toEqual(expect.arrayContaining(['FULL JOIN', 'CROSS JOIN']));
    expect(labelsOf('SELECT * FROM users ', 'sqlite')).toContain('FULL JOIN');
    expect(labelsOf('SELECT * FROM users ', 'mysql')).not.toContain('FULL JOIN');
    expect(labelsOf('SELECT * FROM users ', 'mysql')).toContain('CROSS JOIN');
  });

  it('offers RETURNING for postgres/sqlite writes, never for mysql', () => {
    for (const sql of ['DELETE FROM users ', 'UPDATE users SET name = 1 ', 'INSERT INTO users (id) VALUES (1) ']) {
      expect(labelsOf(sql, 'postgres')).toContain('RETURNING');
      expect(labelsOf(sql, 'sqlite')).toContain('RETURNING');
      expect(labelsOf(sql, 'mysql')).not.toContain('RETURNING');
    }
    expect(labelsOf('SELECT * FROM users ', 'postgres')).not.toContain('RETURNING');
  });

  it('offers the right upsert clause after INSERT … VALUES', () => {
    const sql = 'INSERT INTO users (id) VALUES (1) ';
    expect(labelsOf(sql, 'postgres')).toContain('ON CONFLICT');
    expect(labelsOf(sql, 'sqlite')).toContain('ON CONFLICT');
    expect(labelsOf(sql, 'mysql')).toContain('ON DUPLICATE KEY UPDATE');
    expect(labelsOf(sql, 'mysql')).not.toContain('ON CONFLICT');
    expect(labelsOf(sql, 'postgres')).not.toContain('ON DUPLICATE KEY UPDATE');
    // Not before the VALUES/SELECT body exists.
    expect(labelsOf('INSERT INTO users ', 'postgres')).not.toContain('ON CONFLICT');
  });

  it('offers DEFAULT as a value except on sqlite', () => {
    expect(labelsOf('UPDATE users SET name = ', 'postgres')).toContain('DEFAULT');
    expect(labelsOf('UPDATE users SET name = ', 'mysql')).toContain('DEFAULT');
    expect(labelsOf('UPDATE users SET name = ', 'sqlite')).not.toContain('DEFAULT');
  });
});

describe('IS DISTINCT FROM does not act as a table source', () => {
  it('suggests columns, not the table list, after the operator', () => {
    const sql = 'SELECT * FROM users WHERE id IS DISTINCT FROM ';
    expect(columnLabels(sql)).toEqual(expect.arrayContaining(ALL_COLS));
    expect(labelsOf(sql)).not.toContain('orders');
  });

  it('suggests columns right after typing the keyword (no trailing space)', () => {
    const sql = 'SELECT * FROM users WHERE id IS DISTINCT FROM';
    expect(columnLabels(sql)).toEqual(expect.arrayContaining(ALL_COLS));
    expect(insertFor(sql, 'email')).toBe(' email');
    expect(labelsOf(sql)).not.toContain('orders');
  });

  it('leaves a real FROM/JOIN table slot untouched', () => {
    expect(labelsOf('SELECT DISTINCT id FROM ')).toEqual(expect.arrayContaining(['users', 'orders']));
  });
});

describe('FK-aware JOIN ON suggestions', () => {
  const fkTables: TableInfo[] = [
    { schema: 'public', name: 'users', type: 'table' },
    { schema: 'public', name: 'orders', type: 'table' },
  ];
  const fkCols: Record<string, ColumnInfo[]> = {
    'public.users': [{ name: 'id', dataType: 'int', isNullable: false, isPrimary: true, isForeign: false }],
    'public.orders': [
      { name: 'id', dataType: 'int', isNullable: false, isPrimary: true, isForeign: false },
      {
        name: 'user_id',
        dataType: 'int',
        isNullable: false,
        isPrimary: false,
        isForeign: true,
        foreignTable: 'users',
        foreignColumn: 'id',
      },
    ],
  };
  const fkComplete = (text: string) => {
    const parsed = parseQueryContext(text, fkTables, schemas, 'postgres');
    const columnsByTable: Record<string, ColumnInfo[]> = {};
    for (const ref of bindingsNeedingColumns(text, parsed, { tables: fkTables, schemas, driver: 'postgres' })) {
      const key = columnCacheKey(ref.schema, ref.table);
      columnsByTable[key] = fkCols[key] ?? [];
    }
    const ctx: CompletionContext = {
      schemas,
      tables: fkTables,
      columns: [],
      tablesBySchema: { public: fkTables },
      columnsByTable,
      driver: 'postgres',
    };
    return buildCompletionItems({ ctx, text, position: text.length, parsed });
  };

  it('offers the FK join condition first, right after ON', () => {
    const items = fkComplete('SELECT * FROM users JOIN orders ON ');
    expect(items[0].label).toBe('orders.user_id = users.id');
    expect(items[0].detail).toBe('foreign key');
  });

  it('uses aliases in the condition when present', () => {
    const items = fkComplete('SELECT * FROM users u JOIN orders o ON ');
    expect(items[0].label).toBe('o.user_id = u.id');
  });

  it('space-prefixes the condition when the caret butts against ON', () => {
    const items = fkComplete('SELECT * FROM users JOIN orders ON');
    expect(items[0].insertText).toBe(' orders.user_id = users.id');
  });

  it('does not offer join conditions away from ON', () => {
    const labels = fkComplete('SELECT * FROM users JOIN orders ON orders.user_id = users.id WHERE ').map(
      (i) => i.label,
    );
    expect(labels.some((l) => l.includes('='))).toBe(false);
  });
});

describe('CTE and derived-table columns', () => {
  it('parses CTE projections (explicit list, AS aliases, qualified names)', () => {
    const parsed = parseQueryContext(
      'WITH recent AS (SELECT u.id, email AS mail, count(*) AS n FROM users u) SELECT * FROM recent',
      tables,
      schemas,
      'postgres',
    );
    expect(parsed.virtualColumns.get('recent')).toEqual(['id', 'mail', 'n']);

    const explicit = parseQueryContext('WITH r (a, b) AS (SELECT 1, 2) SELECT * FROM r', tables, schemas, 'postgres');
    expect(explicit.virtualColumns.get('r')).toEqual(['a', 'b']);
  });

  it('completes cte. with the projected columns', () => {
    const labels = labelsOf('WITH recent AS (SELECT id, email AS mail FROM users) SELECT * FROM recent WHERE recent.');
    expect(labels).toEqual(['id', 'mail']);
  });

  it('offers CTE columns unqualified in WHERE once the CTE is referenced', () => {
    const sql = 'WITH recent AS (SELECT id, email AS mail FROM users) SELECT * FROM recent WHERE ';
    expect(labelsOf(sql)).toEqual(expect.arrayContaining(['mail']));
    // Declared but unreferenced CTEs stay out of scope.
    const unref = 'WITH recent AS (SELECT email AS mail FROM users) SELECT * FROM orders WHERE ';
    expect(labelsOf(unref)).not.toContain('mail');
  });

  it('binds a derived-table alias and its projection', () => {
    const sql = 'SELECT * FROM (SELECT id, name AS label FROM users) sub WHERE sub.';
    expect(labelsOf(sql)).toEqual(['id', 'label']);
    const parsed = parseQueryContext(sql, tables, schemas, 'postgres');
    expect(parsed.virtualColumns.get('sub')).toEqual(['id', 'label']);
  });

  it('continues the FROM comma list after a derived table', () => {
    const parsed = parseQueryContext('SELECT * FROM (SELECT 1 AS x) sub, orders WHERE ', tables, schemas, 'postgres');
    expect(parsed.queryTables.map((t) => t.table)).toContain('orders');
    expect(parsed.virtualColumns.get('sub')).toEqual(['x']);
  });

  it('yields no columns for an opaque projection (SELECT *) without crashing', () => {
    expect(labelsOf('WITH r AS (SELECT * FROM users) SELECT * FROM r WHERE r.')).toEqual([]);
  });

  it('never asks the backend for a virtual relation’s columns', () => {
    const sql = 'WITH recent AS (SELECT id FROM users) SELECT * FROM recent WHERE ';
    const parsed = parseQueryContext(sql, tables, schemas, 'postgres');
    const needed = bindingsNeedingColumns(sql, parsed, { tables, schemas, driver: 'postgres' });
    expect(needed.map((b) => b.table)).not.toContain('recent');
  });
});

describe('column suggestions carry PK / NOT NULL hints', () => {
  it('annotates the detail line', () => {
    const items = complete('SELECT * FROM users WHERE ');
    const detailOf = (l: string) => items.find((i) => i.label === l)?.detail;
    expect(detailOf('id')).toBe('int · PK');
    expect(detailOf('email')).toBe('text · not null');
    expect(detailOf('name')).toBe('text');
  });
});

describe('ambiguous columns across joined sources are offered qualified', () => {
  const cols: Record<string, ColumnInfo[]> = {
    'public.users': [
      { name: 'id', dataType: 'int', isNullable: false, isPrimary: true, isForeign: false },
      { name: 'email', dataType: 'text', isNullable: false, isPrimary: false, isForeign: false },
    ],
    'public.orders': [
      { name: 'id', dataType: 'int', isNullable: false, isPrimary: true, isForeign: false },
      { name: 'total', dataType: 'numeric', isNullable: true, isPrimary: false, isForeign: false },
    ],
  };
  const ambComplete = (text: string) => {
    const ctx: CompletionContext = {
      schemas,
      tables,
      columns: [],
      tablesBySchema: { public: tables },
      columnsByTable: cols,
      driver: 'postgres',
    };
    const parsed = parseQueryContext(text, tables, schemas, 'postgres');
    return buildCompletionItems({ ctx, text, position: text.length, parsed });
  };

  it('qualifies the shared column per source and keeps unique columns bare', () => {
    const labels = ambComplete('SELECT * FROM users u JOIN orders o ON u.id = o.id WHERE ').map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['u.id', 'o.id', 'email', 'total']));
    expect(labels).not.toContain('id');
  });

  it('uses the table name as qualifier when there is no alias', () => {
    const labels = ambComplete('SELECT * FROM users JOIN orders ON ').map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['users.id', 'orders.id']));
    expect(labels).not.toContain('id');
  });

  it('qualifies every column of a self-join per alias', () => {
    const labels = ambComplete('SELECT * FROM users a JOIN users b ON ').map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['a.id', 'b.id', 'a.email', 'b.email']));
    expect(labels).not.toContain('id');
    expect(labels).not.toContain('email');
  });

  it('keeps single-table statements fully bare', () => {
    expect(columnLabels('SELECT * FROM users WHERE ')).toEqual(expect.arrayContaining(ALL_COLS));
  });

  it('driver-quotes the qualifier in the inserted text', () => {
    const capTables: TableInfo[] = [
      { schema: 'public', name: 'Users', type: 'table' },
      { schema: 'public', name: 'orders', type: 'table' },
    ];
    const shared: ColumnInfo[] = [
      { name: 'id', dataType: 'int', isNullable: false, isPrimary: true, isForeign: false },
    ];
    const ctx: CompletionContext = {
      schemas,
      tables: capTables,
      columns: [],
      tablesBySchema: { public: capTables },
      columnsByTable: { 'public.Users': shared, 'public.orders': shared },
      driver: 'postgres',
    };
    const text = 'SELECT * FROM "Users" JOIN orders ON ';
    const items = buildCompletionItems({
      ctx,
      text,
      position: text.length,
      parsed: parseQueryContext(text, capTables, schemas, 'postgres'),
    });
    expect(items.find((i) => i.label === 'Users.id')?.insertText).toBe('"Users".id');
    expect(items.find((i) => i.label === 'orders.id')?.insertText).toBe('orders.id');
  });
});

describe('SELECT list offers the statement’s table refs (mid-statement edit)', () => {
  it('offers alias, table and columns while editing the select list', () => {
    const text = 'SELECT  FROM users u';
    const position = 'SELECT '.length;
    const parsed = parseQueryContext(text, tables, schemas, 'postgres');
    const labels = buildCompletionItems({ ctx: makeCtx(), text, position, parsed }).map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['u', 'users', 'id', 'email', 'name']));
  });
});

describe('keywords are offered by position', () => {
  it('offers statement starters only at the very start', () => {
    expect(labelsOf('SEL')).toEqual(expect.arrayContaining(['SELECT']));
    const mid = labelsOf('SELECT * FROM users ');
    for (const kw of ['SELECT', 'INSERT INTO', 'CREATE TABLE', 'UPDATE', 'DELETE']) {
      expect(mid).not.toContain(kw);
    }
  });

  it('offers ON only once a JOIN is present', () => {
    expect(labelsOf('SELECT * FROM users ')).not.toContain('ON');
    expect(labelsOf('SELECT * FROM users JOIN orders ')).toContain('ON');
  });

  it('gates SET/VALUES on UPDATE/INSERT', () => {
    expect(labelsOf('SELECT * FROM users ')).not.toContain('SET');
    expect(labelsOf('SELECT * FROM users ')).not.toContain('VALUES');
  });
});
