/**
 * SQL editor pipeline benchmark.
 *
 * Replays exactly what the editor runs at runtime, per keystroke:
 *   - run-glyphs:   parseSqlStatements(fullText)                      (useRunGlyphs)
 *   - completion:   parseSqlStatements -> currentStatementRange ->
 *                   parseQueryContext(stmt) -> bindingsNeedingColumns ->
 *                   buildCompletionItems -> completionReplaceRange    (createSqlCompletionProvider)
 *   - diagnostics:  collectSchemaDiagnostics(fullText)                (useSqlDiagnostics, debounce fire)
 *   - hover:        parseSqlStatements -> currentStatementRange ->
 *                   parseQueryContext(stmt) -> analyzeHover           (createSqlHoverProvider)
 *
 * Identical file is run on both branches; results go to BENCH_OUT as JSON.
 */
import fs from 'node:fs';
import i18n from 'i18next';
import { it } from 'vitest';
import {
  bindingsNeedingColumns,
  buildCompletionItems,
  completionReplaceRange,
} from '@/features/editor/lib/sqlCompletion';
import { collectSchemaDiagnostics } from '@/features/editor/lib/sqlDiagnostics';
import { analyzeHover } from '@/features/editor/lib/sqlHover';
import { parseQueryContext } from '@/features/editor/lib/sqlQueryParse';
import { columnCacheKey } from '@/features/editor/lib/sqlQuoting';
import { currentStatementRange, parseSqlStatements } from '@/features/editor/lib/sqlStatements';
import type { CompletionContext } from '@/features/editor/lib/sqlSuggestions';
import bg from '@/i18n/locales/bg.json';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';
import type { ColumnInfo, DriverType, SchemaInfo, TableInfo } from '@/types';

// Same init as src/test/setupI18n.ts (the app inits the same singleton at boot).
if (!i18n.isInitialized) {
  await i18n.init({
    resources: { en: { translation: en }, de: { translation: de }, bg: { translation: bg } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
}

const DRIVER: DriverType = 'postgres' as DriverType;

// ---------- fixture: 250 tables x 40 columns, shared id/created_at/updated_at ----------

const TYPES = ['integer', 'text', 'numeric(12,2)', 'timestamptz', 'boolean', 'uuid', 'jsonb', 'bigint'];

function makeColumns(table: string): ColumnInfo[] {
  const cols: ColumnInfo[] = [
    { name: 'id', dataType: 'integer', isNullable: false, isPrimary: true, isForeign: false },
    { name: 'created_at', dataType: 'timestamptz', isNullable: false, isPrimary: false, isForeign: false },
    { name: 'updated_at', dataType: 'timestamptz', isNullable: true, isPrimary: false, isForeign: false },
  ];
  for (let i = 0; i < 37; i++) {
    cols.push({
      name: `${table}_c${i}`,
      dataType: TYPES[i % TYPES.length],
      isNullable: i % 3 !== 0,
      isPrimary: false,
      isForeign: i === 5,
      foreignTable: i === 5 ? 'users' : undefined,
      foreignColumn: i === 5 ? 'id' : undefined,
    });
  }
  return cols;
}

const NAMED = ['users', 'orders', 'order_items', 'products', 'customers'];
const tables: TableInfo[] = [];
for (const name of NAMED) tables.push({ schema: 'public', name, type: 'table' });
for (let i = NAMED.length; i < 250; i++)
  tables.push({ schema: 'public', name: `t_${String(i).padStart(3, '0')}`, type: i % 10 === 0 ? 'view' : 'table' });

const schemas: SchemaInfo[] = [{ name: 'public' }, { name: 'analytics' }, { name: 'audit' }];
const tablesBySchema: Record<string, TableInfo[]> = { public: tables, analytics: [], audit: [] };

const columnsByTable: Record<string, ColumnInfo[]> = {};
for (const tbl of tables) columnsByTable[columnCacheKey(tbl.schema, tbl.name)] = makeColumns(tbl.name);
// Domain columns used by the typed queries.
columnsByTable['public.users'].push(
  { name: 'email', dataType: 'text', isNullable: false, isPrimary: false, isForeign: false },
  { name: 'full_name', dataType: 'text', isNullable: true, isPrimary: false, isForeign: false },
);
columnsByTable['public.orders'].push(
  { name: 'total', dataType: 'numeric(12,2)', isNullable: false, isPrimary: false, isForeign: false },
  {
    name: 'user_id',
    dataType: 'integer',
    isNullable: false,
    isPrimary: false,
    isForeign: true,
    foreignTable: 'users',
    foreignColumn: 'id',
  },
  {
    name: 'customer_id',
    dataType: 'integer',
    isNullable: false,
    isPrimary: false,
    isForeign: true,
    foreignTable: 'customers',
    foreignColumn: 'id',
  },
);
columnsByTable['public.order_items'].push(
  {
    name: 'order_id',
    dataType: 'integer',
    isNullable: false,
    isPrimary: false,
    isForeign: true,
    foreignTable: 'orders',
    foreignColumn: 'id',
  },
  {
    name: 'product_id',
    dataType: 'integer',
    isNullable: false,
    isPrimary: false,
    isForeign: true,
    foreignTable: 'products',
    foreignColumn: 'id',
  },
);

const ctx: CompletionContext = { schemas, tables, columns: [], tablesBySchema, columnsByTable, driver: DRIVER };

// ---------- measurement plumbing ----------

interface Stats {
  n: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  totalMs: number;
}

function stats(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const total = s.reduce((a, b) => a + b, 0);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return {
    n: s.length,
    meanMs: total / (s.length || 1),
    p50Ms: q(0.5),
    p95Ms: q(0.95),
    maxMs: s[s.length - 1] ?? 0,
    totalMs: total,
  };
}

let peakRss = 0;
function sampleRss(): void {
  const rss = process.memoryUsage().rss;
  if (rss > peakRss) peakRss = rss;
}

function gcNow(): void {
  (globalThis as { gc?: () => void }).gc?.();
}

// ---------- editor pipeline replicas ----------

function glyphPass(text: string): number {
  return parseSqlStatements(text, DRIVER).length;
}

function completionRequest(text: string, offset: number): number {
  const { start, end } = currentStatementRange(parseSqlStatements(text, DRIVER), offset, text.length);
  const textBefore = text.slice(start, offset);
  const parsed = parseQueryContext(text.slice(start, end), tables, schemas, DRIVER);
  bindingsNeedingColumns(textBefore, parsed, { tables, schemas, driver: DRIVER });
  const items = buildCompletionItems({ ctx, text, position: offset, parsed, statementStart: start });
  completionReplaceRange(
    { lineNumber: 1, column: offset + 1 },
    textBefore,
    { startColumn: offset + 1, endColumn: offset + 1 },
    DRIVER,
  );
  return items.length;
}

function diagnosticsFire(text: string): number {
  return collectSchemaDiagnostics(text, tables, schemas, DRIVER).length;
}

function hoverRequest(text: string, offset: number): boolean {
  const { start, end } = currentStatementRange(parseSqlStatements(text, DRIVER), offset, text.length);
  const stmt = text.slice(start, end);
  const parsed = parseQueryContext(stmt, tables, schemas, DRIVER);
  return analyzeHover(stmt, offset - start, parsed, tables, schemas, DRIVER) !== null;
}

// ---------- workloads ----------

interface WorkloadResult {
  buckets: Record<string, Stats>;
  wallMs: number;
  cpuUserMs: number;
  cpuSysMs: number;
  checksum: number;
}

function runWorkload(fn: (push: (bucket: string, ms: number) => void) => number): WorkloadResult {
  const buckets: Record<string, number[]> = {};
  const push = (bucket: string, ms: number) => {
    buckets[bucket] ??= [];
    buckets[bucket].push(ms);
  };
  gcNow();
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  const checksum = fn(push);
  const wallMs = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  const out: Record<string, Stats> = {};
  for (const [k, v] of Object.entries(buckets)) out[k] = stats(v);
  return { buckets: out, wallMs, cpuUserMs: cpu.user / 1000, cpuSysMs: cpu.system / 1000, checksum };
}

function typedQuery(salt: string): string {
  return (
    `SELECT u.id, u.email, o.total FROM users u JOIN orders o ON o.user_id = u.id ` +
    `WHERE u.email LIKE 'a${salt}%' AND o.total > 100 ORDER BY o.created_at DESC`
  );
}

// Simulates typing `typed` at the end of `prefix`, running the per-keystroke pipeline.
function typingSession(prefix: string, typed: string, push: (b: string, ms: number) => void, diagEvery = 12): number {
  let checksum = 0;
  for (let k = 1; k <= typed.length; k++) {
    const text = prefix + typed.slice(0, k);
    const offset = text.length;

    let t0 = performance.now();
    checksum += glyphPass(text);
    push('glyphs', performance.now() - t0);

    t0 = performance.now();
    checksum += completionRequest(text, offset);
    push('completion', performance.now() - t0);

    if (k % diagEvery === 0 || k === typed.length) {
      t0 = performance.now();
      checksum += diagnosticsFire(text);
      push('diagnostics', performance.now() - t0);
    }
    sampleRss();
  }
  return checksum;
}

const W1_SESSIONS = 8;
function w1(push: (b: string, ms: number) => void): number {
  let checksum = 0;
  for (let s = 0; s < W1_SESSIONS; s++) checksum += typingSession('', typedQuery(`s${s}`), push);
  return checksum;
}

const W2_SESSIONS = 6;
const W2_STATEMENTS = 150;
function bigFilePrefix(salt: string): string {
  const lines: string[] = [];
  for (let i = 0; i < W2_STATEMENTS; i++) {
    const t = `t_${String((i % 245) + 5).padStart(3, '0')}`;
    lines.push(`SELECT id, created_at, ${t}_c${i % 37} FROM ${t} WHERE ${t}_c3 = ${i} /*${salt}*/;`);
  }
  return `${lines.join('\n')}\n`;
}
function w2(push: (b: string, ms: number) => void): number {
  let checksum = 0;
  for (let s = 0; s < W2_SESSIONS; s++) checksum += typingSession(bigFilePrefix(`s${s}`), typedQuery(`s${s}`), push);
  return checksum;
}

const W3_SESSIONS = 8;
function w3(push: (b: string, ms: number) => void): number {
  let checksum = 0;
  for (let s = 0; s < W3_SESSIONS; s++) {
    const fixed =
      `/*s${s}*/ SELECT * FROM users u JOIN orders o ON o.user_id = u.id ` +
      `JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id ` +
      `JOIN customers c ON c.id = o.customer_id WHERE `;
    const typedTail = 'created_at > now() AND u.email = c.customers_c1';
    checksum += typingSession('', fixed, push, 1_000_000); // no diag churn here
    for (let k = 1; k <= typedTail.length; k++) {
      const text = fixed + typedTail.slice(0, k);
      const t0 = performance.now();
      checksum += completionRequest(text, text.length);
      push('completion-wide', performance.now() - t0);
      sampleRss();
    }
  }
  return checksum;
}

const W4_SESSIONS = 6;
const W4_SWEEPS = 40;
function w4(push: (b: string, ms: number) => void): number {
  let checksum = 0;
  for (let s = 0; s < W4_SESSIONS; s++) {
    const text = typedQuery(`s${s}`);
    for (let sweep = 0; sweep < W4_SWEEPS; sweep++) {
      for (let offset = 0; offset < text.length; offset += 3) {
        const t0 = performance.now();
        checksum += hoverRequest(text, offset) ? 1 : 0;
        push('hover', performance.now() - t0);
      }
      sampleRss();
    }
  }
  return checksum;
}

// ---------- main ----------

it('sql editor pipeline benchmark', () => {
  // JIT warmup on salted inputs that are never measured.
  {
    const sink: string[] = [];
    typingSession('', typedQuery('warm'), () => sink.push(''), 10);
    typingSession(bigFilePrefix('warm'), typedQuery('warm'), () => sink.push(''), 10);
  }
  gcNow();
  const baselineHeap = process.memoryUsage().heapUsed;
  peakRss = 0;
  sampleRss();

  const results: Record<string, WorkloadResult> = {};
  results.typing_small = runWorkload(w1);
  results.typing_bigfile = runWorkload(w2);
  results.completion_wide = runWorkload(w3);
  results.hover_sweep = runWorkload(w4);

  const finalRssBeforeGc = process.memoryUsage().rss;
  gcNow();
  const retainedHeap = process.memoryUsage().heapUsed - baselineHeap;

  const out = {
    node: process.version,
    side: process.env.BENCH_SIDE ?? 'unknown',
    run: Number(process.env.BENCH_RUN ?? 0),
    workloads: results,
    memory: {
      baselineHeapMB: baselineHeap / 1048576,
      retainedHeapMB: retainedHeap / 1048576,
      peakRssMB: peakRss / 1048576,
      finalRssMB: finalRssBeforeGc / 1048576,
      // darwin reports maxRSS in bytes, linux in KiB.
      maxRssMB: process.resourceUsage().maxRSS / (process.platform === 'darwin' ? 1048576 : 1024),
    },
  };

  const dest = process.env.BENCH_OUT;
  if (dest) fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}, 900_000);
