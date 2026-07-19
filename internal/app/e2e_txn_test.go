//go:build e2e

package app

import (
	"testing"

	"xensql/internal/database"
)

// execOnTab runs a statement on the tab's execution target - the pinned
// transaction if one is open, otherwise a fresh connection - exactly as the
// streaming batch path does via batchExecutor.
func execOnTab(t *testing.T, a *App, connID, tabID, sql string) {
	t.Helper()
	exec, release, err := a.batchExecutor(testCtx(), tabID, connID)
	if err != nil {
		t.Fatalf("batchExecutor: %v", err)
	}
	if release != nil {
		defer release()
	}
	if _, err := exec.ExecuteStream(testCtx(), sql, database.StreamOpts{}); err != nil {
		t.Fatalf("exec on tab %q: %v", tabID, err)
	}
}

func countRows(t *testing.T, a *App, e engine, connID, table string) int64 {
	t.Helper()
	res, err := a.ExecuteQuery(connID, "SELECT count(*) FROM "+qualified(e, table))
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	return asInt64(res.Rows[0][0])
}

// TestE2ETransactionCommit checks that writes inside a pinned tab transaction are
// invisible to other connections until commit, then durable after it.
func TestE2ETransactionCommit(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := uniqueTable("txn_commit")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)
		tabID := "tab-commit-" + table

		if err := a.BeginTransaction(connID, tabID); err != nil {
			t.Fatalf("BeginTransaction: %v", err)
		}
		if !a.TransactionStatus(tabID) {
			t.Fatal("TransactionStatus should be true after BeginTransaction")
		}

		execOnTab(t, a, connID, tabID, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('t1')")
		execOnTab(t, a, connID, tabID, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('t2')")

		// A separate connection must not see the uncommitted rows.
		if n := countRows(t, a, e, connID, table); n != 0 {
			t.Fatalf("uncommitted rows visible to other connection: count = %d, want 0", n)
		}

		if err := a.CommitTransaction(tabID); err != nil {
			t.Fatalf("CommitTransaction: %v", err)
		}
		if a.TransactionStatus(tabID) {
			t.Fatal("TransactionStatus should be false after commit")
		}
		if n := countRows(t, a, e, connID, table); n != 2 {
			t.Fatalf("after commit count = %d, want 2", n)
		}
	})
}

// TestE2ETransactionRollback checks rolled-back writes leave no trace.
func TestE2ETransactionRollback(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := uniqueTable("txn_rollback")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)
		tabID := "tab-rollback-" + table

		if err := a.BeginTransaction(connID, tabID); err != nil {
			t.Fatalf("BeginTransaction: %v", err)
		}
		execOnTab(t, a, connID, tabID, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('gone')")

		if err := a.RollbackTransaction(tabID); err != nil {
			t.Fatalf("RollbackTransaction: %v", err)
		}
		if a.TransactionStatus(tabID) {
			t.Fatal("TransactionStatus should be false after rollback")
		}
		if n := countRows(t, a, e, connID, table); n != 0 {
			t.Fatalf("after rollback count = %d, want 0", n)
		}
	})
}

// TestE2ETransactionGuards checks the guard rails: a tab id is required, a tab can
// only hold one transaction, commit needs an open transaction and closing a tab
// rolls back its open transaction.
func TestE2ETransactionGuards(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		if err := a.BeginTransaction(connID, ""); err == nil {
			t.Error("BeginTransaction with empty tab id should fail")
		}

		table := uniqueTable("txn_guard")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)
		tabID := "tab-guard-" + table

		if err := a.BeginTransaction(connID, tabID); err != nil {
			t.Fatalf("BeginTransaction: %v", err)
		}
		if err := a.BeginTransaction(connID, tabID); err == nil {
			t.Error("a second BeginTransaction on the same tab should fail")
		}

		// CleanupTabTransaction (called when a tab closes) must roll back the open txn.
		execOnTab(t, a, connID, tabID, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('orphan')")
		a.CleanupTabTransaction(tabID)
		if a.TransactionStatus(tabID) {
			t.Error("TransactionStatus should be false after cleanup")
		}
		if n := countRows(t, a, e, connID, table); n != 0 {
			t.Errorf("cleanup should roll back; count = %d, want 0", n)
		}

		if err := a.CommitTransaction("tab-never-opened-" + table); err == nil {
			t.Error("CommitTransaction without an open transaction should fail")
		}
	})
}

// TestE2ETransactionsAreConcurrentPerTab checks two tabs hold independent
// transactions on the same connection without interfering.
func TestE2ETransactionsAreConcurrentPerTab(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		table := uniqueTable("txn_multi")
		createTempTable(t, a, e, connID, e.autoPKTable(table), table)
		tabA := "tabA-" + table
		tabB := "tabB-" + table

		if err := a.BeginTransaction(connID, tabA); err != nil {
			t.Fatalf("begin A: %v", err)
		}
		if err := a.BeginTransaction(connID, tabB); err != nil {
			t.Fatalf("begin B: %v", err)
		}
		execOnTab(t, a, connID, tabA, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('a')")
		execOnTab(t, a, connID, tabB, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('b')")

		// Commit A, roll back B: only A's row should survive.
		if err := a.CommitTransaction(tabA); err != nil {
			t.Fatalf("commit A: %v", err)
		}
		if err := a.RollbackTransaction(tabB); err != nil {
			t.Fatalf("rollback B: %v", err)
		}
		res, err := a.ExecuteQuery(connID, "SELECT name FROM "+qualified(e, table))
		if err != nil {
			t.Fatalf("select: %v", err)
		}
		if res.RowCount != 1 || res.Rows[0][0] != "a" {
			t.Fatalf("expected only committed row 'a', got %+v", res.Rows)
		}
	})
}
