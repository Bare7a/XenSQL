import { describe, expect, it } from 'vitest';
import {
  bindingsNeedingColumns,
  buildCompletionItems,
  clauseBodyStart,
  columnCacheKey,
  completionReplaceRange,
  identifierNeedsQuote,
  isOrderOrGroupContext,
  parseQueryContext,
  type CompletionContext,
} from '@/features/editor/lib/sqlCompletion';
import { currentStatementStart, parseSqlStatements } from '@/features/editor/lib/sqlStatements';
import type { ColumnInfo, DriverType, SchemaInfo, TableInfo } from '@/types';

const schemas: SchemaInfo[] = [{ name: 'public' }];
const tables: TableInfo[] = [
  { schema: 'public', name: 'users', type: 'table' },
  { schema: 'public', name: 'orders', type: 'table' },
];
const userColumns: ColumnInfo[] = [
  { name: 'id', dataType: 'int', isNullable: false, isPrimary: true },
  { name: 'email', dataType: 'text', isNullable: false, isPrimary: false },
  { name: 'name', dataType: 'text', isNullable: true, isPrimary: false },
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
const insertFor = (text: string, label: string) =>
  complete(text).find((i) => i.label === label)?.insertText;

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
    expect(clauseBodyStart('SELECT * FROM users GROUP BY x HAVING')).toBe('filter');
    expect(clauseBodyStart('SELECT * FROM')).toBe('table');
    expect(clauseBodyStart('SELECT * FROM users JOIN')).toBe('table');
    expect(clauseBodyStart('UPDATE users SET')).toBe('set');
  });

  it('does not mistake identifiers ending in a keyword for the keyword', () => {
    // `brand`/`elsewhere`/`person` end in AND/WHERE/ON but are not keywords.
    expect(clauseBodyStart('SELECT brand')).toBeNull();
    expect(clauseBodyStart('SELECT elsewhere')).toBeNull();
    expect(clauseBodyStart('SELECT * FROM person')).toBeNull();
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
    expect(labelsOf('SELECT * FROM users ORDER BY ')).not.toEqual(
      expect.arrayContaining(['ASC', 'DESC'])
    );
    // Once a column is present, the direction keywords appear.
    expect(labelsOf('SELECT * FROM users ORDER BY name ')).toEqual(
      expect.arrayContaining(['ASC', 'DESC'])
    );
    // GROUP BY never takes a sort direction.
    expect(labelsOf('SELECT * FROM users GROUP BY name ')).not.toEqual(
      expect.arrayContaining(['ASC', 'DESC'])
    );
  });

  it('filters by a partially typed column', () => {
    expect(columnLabels('SELECT * FROM "Users" ORDER BY na')).toEqual(['name']);
  });

  it('resolves an alias qualifier (alias.<col>) inside ORDER BY', () => {
    expect(columnLabels('SELECT * FROM users "U" ORDER BY U.')).toEqual(
      expect.arrayContaining(ALL_COLS)
    );
  });

  it('stops once a terminating clause follows the BY list', () => {
    expect(isOrderOrGroupContext('SELECT * FROM users GROUP BY id HAVING ')).toBe(false);
    expect(isOrderOrGroupContext('SELECT * FROM users ORDER BY id LIMIT ')).toBe(false);
  });
});

describe('inserts respect driver quoting', () => {
  it('quotes a mixed-case column for mysql with backticks', () => {
    const ctx = makeCtx('mysql');
    ctx.columnsByTable['public.users'] = [
      { name: 'First Name', dataType: 'text', isNullable: true, isPrimary: false },
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
    expect(columnLabels('SELECT * FROM users WHERE id = ')).toEqual(
      expect.arrayContaining(ALL_COLS)
    );
    expect(clauseBodyStart('SELECT * FROM users WHERE id =')).toBeNull();
  });

  it('suggests columns in UPDATE … SET', () => {
    expect(columnLabels('UPDATE users SET ')).toEqual(expect.arrayContaining(ALL_COLS));
  });

  it('resolves dotted alias columns in WHERE', () => {
    expect(columnLabels('SELECT * FROM users AS "Users" WHERE "Users".')).toEqual(
      expect.arrayContaining(ALL_COLS)
    );
  });

  it('still offers the keyword list mid-statement', () => {
    expect(labelsOf('SELECT * FROM users ')).toEqual(expect.arrayContaining(['WHERE', 'JOIN']));
  });
});

// Regression: a quoted table in FROM (`FROM "Users"`) broke WHERE completion - the range matched
// from its closing quote (hiding everything), and the table-ref needs a quoted filterText to match.
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
  const userRef = (text: string) =>
    capItems(text).find((i) => i.kind === 'class' && i.insertText.trim() === '"Users"');

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
    expect(scopedLabels('SELECT 1;\nSELECT * FROM ')).toEqual(
      expect.arrayContaining(['users', 'orders'])
    );
  });
});

describe('schema-qualified table completion', () => {
  it('lists a schema\'s tables right after the dot (FROM public.)', () => {
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
    'public.accounts': [{ name: 'id', dataType: 'int', isNullable: false, isPrimary: true }],
    'public.contracts': [
      { name: 'id', dataType: 'int', isNullable: false, isPrimary: true },
      { name: 'account_id', dataType: 'int', isNullable: false, isPrimary: false },
      { name: 'amount', dataType: 'numeric', isNullable: true, isPrimary: false },
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
    const parsed = parseQueryContext(
      'SELECT * FROM accounts JOIN contracts ON ',
      joinTables,
      schemas,
      'postgres'
    );
    expect(parsed.queryTables.map((t) => t.table)).toEqual(['accounts', 'contracts']);
  });

  it('suggests the joined table’s columns for contracts. (the reported case)', () => {
    const text = 'SELECT * FROM accounts \nJOIN contracts ON \naccounts.id = contracts.';
    expect(appComplete(text)).toEqual(['id', 'account_id', 'amount']);
  });

  it('resolves contracts. in the ON clause without an = operator', () => {
    expect(appComplete('SELECT * FROM accounts JOIN contracts ON contracts.')).toEqual([
      'id',
      'account_id',
      'amount',
    ]);
  });

  it('resolves an aliased joined table (c.)', () => {
    expect(appComplete('SELECT * FROM accounts a JOIN contracts c ON c.')).toEqual([
      'id',
      'account_id',
      'amount',
    ]);
  });

  it('keeps a quoted reserved-word alias working (AS "join")', () => {
    const parsed = parseQueryContext(
      'SELECT * FROM accounts AS "join" WHERE ',
      joinTables,
      schemas,
      'postgres'
    );
    expect(parsed.queryTables.map((t) => t.table)).toEqual(['accounts']);
  });

  it('offers the in-scope table-refs after a comparison operator (= <value>)', () => {
    // The RHS of `=` is often another qualified column, so the tables must be offered too.
    expect(appComplete('SELECT * FROM accounts JOIN contracts ON accounts.id = ')).toEqual(
      expect.arrayContaining(['accounts', 'contracts'])
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
    'public.Users': [{ name: 'id', dataType: 'int', isNullable: false, isPrimary: true }],
    'public.EBayAccounts': [
      { name: 'id', dataType: 'int', isNullable: false, isPrimary: true },
      { name: 'userId', dataType: 'int', isNullable: false, isPrimary: false },
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
      expect(labelsOf(sql)).not.toEqual(
        expect.arrayContaining(['users', 'id', 'email', 'WHERE', 'JOIN'])
      );
    }
  });

  it('still offers LIMIT as a keyword mid-statement and while typing it', () => {
    expect(labelsOf('SELECT * FROM users ')).toEqual(expect.arrayContaining(['LIMIT']));
    expect(labelsOf('SELECT * FROM users LIMI')).toEqual(expect.arrayContaining(['LIMIT']));
  });

  it('leaves the ORDER BY tail (ASC/DESC + columns) unchanged', () => {
    expect(labelsOf('SELECT * FROM users ORDER BY id ')).toEqual(
      expect.arrayContaining(['ASC', 'DESC'])
    );
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
      const snippetLike = labels.filter(
        (l) => l.includes('(…)') || l.includes('… ON') || l.startsWith('FROM …')
      );
      expect(snippetLike).toEqual([]);
    });
  }
});

// Reported: hitting space after a finished term (e.g. `ORDER BY col DESC`) kept offering
// columns/tables. They should follow only an identifier-expecting token, not a completed one.
describe('column/table suggestions only follow an identifier-expecting token', () => {
  it('offers columns right after a trigger token', () => {
    expect(columnLabels('SELECT * FROM users WHERE ')).toEqual(expect.arrayContaining(ALL_COLS));
    expect(columnLabels('SELECT * FROM users WHERE id = 1 AND ')).toEqual(
      expect.arrayContaining(ALL_COLS)
    );
    expect(columnLabels('SELECT * FROM users WHERE id = 1 OR ')).toEqual(
      expect.arrayContaining(ALL_COLS)
    );
    expect(columnLabels('SELECT * FROM users WHERE id >= ')).toEqual(
      expect.arrayContaining(ALL_COLS)
    );
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
    expect(labelsOf('SELECT * FROM users WHERE id ')).toEqual(
      expect.arrayContaining(['AND', 'OR'])
    );
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
    expect(labelsOf('SELECT * FROM users, orders WHERE ')).toEqual(
      expect.arrayContaining(['users', 'orders'])
    );
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
      'postgres'
    );
    expect(parsed.ctes).toEqual(['a', 'b']);
  });

  it('does not invent CTEs from AS-aliased columns (no leading WITH)', () => {
    const parsed = parseQueryContext('SELECT a AS x FROM users', tables, schemas, 'postgres');
    expect(parsed.ctes).toEqual([]);
  });

  it('suggests the CTE name in the FROM slot (with and without a prefix)', () => {
    expect(labelsOf('WITH recent AS (SELECT 1) SELECT * FROM ')).toEqual(
      expect.arrayContaining(['recent'])
    );
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

describe('column suggestions carry PK / NOT NULL hints', () => {
  it('annotates the detail line', () => {
    const items = complete('SELECT * FROM users WHERE ');
    const detailOf = (l: string) => items.find((i) => i.label === l)?.detail;
    expect(detailOf('id')).toBe('int · PK');
    expect(detailOf('email')).toBe('text · not null');
    expect(detailOf('name')).toBe('text');
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
