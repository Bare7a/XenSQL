package main

import "fmt"

// BeginTransaction pins a dedicated connection to the tab and opens a transaction.
// Subsequent ExecuteQueryStream calls for tabID will run on that connection until
// CommitTransaction or RollbackTransaction is called.
func (a *App) BeginTransaction(connectionID, tabID string) error {
	if tabID == "" {
		return fmt.Errorf("tab id is required")
	}
	if _, ok := a.txns.Get(tabID); ok {
		return fmt.Errorf("transaction already active on this tab")
	}
	if err := a.guardExecute(connectionID, "BEGIN"); err != nil {
		return err
	}
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return err
	}
	txn, err := s.BeginTxn(a.ctx)
	if err != nil {
		return err
	}
	// Lost the race to a concurrent Begin for this tab: discard the connection we just pinned so it
	// doesn't leak with an open transaction on the server.
	if err := a.txns.Begin(tabID, txn); err != nil {
		_ = txn.Rollback(a.ctx)
		txn.Close()
		return err
	}
	return nil
}

// CommitTransaction commits the open transaction on the tab and releases the pinned connection.
func (a *App) CommitTransaction(tabID string) error {
	txn, ok := a.txns.Get(tabID)
	if !ok {
		return fmt.Errorf("no active transaction on this tab")
	}
	a.txns.End(tabID)
	defer txn.Close()
	return txn.Commit(a.ctx)
}

// RollbackTransaction rolls back the open transaction on the tab and releases the pinned connection.
func (a *App) RollbackTransaction(tabID string) error {
	txn, ok := a.txns.Get(tabID)
	if !ok {
		return fmt.Errorf("no active transaction on this tab")
	}
	a.txns.End(tabID)
	defer txn.Close()
	return txn.Rollback(a.ctx)
}

// CleanupTabTransaction rolls back any open transaction for the tab. Called when a tab is closed.
func (a *App) CleanupTabTransaction(tabID string) {
	txn, ok := a.txns.Get(tabID)
	if !ok {
		return
	}
	a.txns.End(tabID)
	_ = txn.Rollback(a.ctx)
	txn.Close()
}

// TransactionStatus returns whether the given tab has an active transaction.
func (a *App) TransactionStatus(tabID string) bool {
	_, ok := a.txns.Get(tabID)
	return ok
}

