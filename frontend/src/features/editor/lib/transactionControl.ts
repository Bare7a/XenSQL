import { parseSqlStatements } from '@/features/editor/lib/sqlStatements';

export type TxnControlAction = 'begin' | 'commit' | 'rollback';

// Classifies `sql` when it is exactly one transaction-control statement - BEGIN / START TRANSACTION
// / COMMIT / ROLLBACK and their WORK/TRANSACTION variants - ignoring comments, surrounding
// whitespace, and a single trailing semicolon. Returns null for anything else, so ordinary queries
// (and a control keyword bundled with other statements, or `ROLLBACK TO SAVEPOINT ...`, which must
// run inside the transaction rather than end it) fall through to normal execution.
export function detectTransactionControl(sql: string): TxnControlAction | null {
  const statements = parseSqlStatements(sql);
  if (statements.length !== 1) return null;
  const code = statements[0].text
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/--[^\n]*/g, ' ') // line comments
    .replace(/;\s*$/, '') // trailing semicolon
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (/^BEGIN( WORK| TRANSACTION)?$/.test(code) || code === 'START TRANSACTION') return 'begin';
  if (/^COMMIT( WORK| TRANSACTION)?$/.test(code)) return 'commit';
  if (/^ROLLBACK( WORK| TRANSACTION)?$/.test(code)) return 'rollback';
  return null;
}
