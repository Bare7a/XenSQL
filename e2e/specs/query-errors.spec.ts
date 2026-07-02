import { expect, test } from '../fixtures';
import { POSTGRES } from '../support/databases';

// Postgres-specific: only pgconn reports an error position, and these codes are Postgres SQLSTATEs.
// The cross-driver smoke check lives in queries.spec.ts.
test.describe('Query errors', () => {
  test('shows a structured error card: code, message and hint', async ({ app, connections, editor, results }) => {
    await connections.createAndConnect(POSTGRES);

    // Missing function → SQLSTATE 42883 + message + HINT.
    await editor.run('SELECT nonexistent_func_e2e();');

    await expect(results.errorCard).toBeVisible();
    await expect(results.errorCode).toHaveText('42883');
    await expect(results.errorMessage).toContainText('nonexistent_func_e2e');
    await expect(results.errorHint).toContainText('No function matches');
    await expect(app.status).toHaveClass(/error/);
  });

  test('jump-to-error focuses the editor and marks the flagged token', async ({ connections, editor, results }) => {
    await connections.createAndConnect(POSTGRES);

    await editor.run('SELECT * FROM definitely_missing_table_e2e;');
    await expect(results.errorCode).toHaveText('42P01');

    await expect(results.jumpToErrorButton).toBeVisible();
    await results.jumpToErrorButton.click();

    await expect.poll(() => editor.errorMarker.count()).toBeGreaterThan(0);
    // Focus returns to the editor (Monaco marks it .focused).
    await expect(editor.monaco).toHaveClass(/\bfocused\b/);
  });

  test('reports a cancelled query calmly, without an error code', async ({ connections, editor, results }) => {
    await connections.createAndConnect(POSTGRES);

    await editor.setSql('SELECT pg_sleep(5);');
    await editor.runAll();
    await editor.stopQuery();

    await expect(results.errorCard).toBeVisible();
    await expect(results.errorMessage).toHaveText('Query cancelled.');
    // No SQLSTATE chip for a cancellation.
    await expect(results.errorCode).toHaveCount(0);
  });
});
