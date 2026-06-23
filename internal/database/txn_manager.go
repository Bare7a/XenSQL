package database

import (
	"context"
	"fmt"
	"sync"
)

// TxnManager tracks one open PinnedTxn per tab. It is safe for concurrent use.
type TxnManager struct {
	mu   sync.Mutex
	txns map[string]PinnedTxn // tabID → active transaction
}

func NewTxnManager() *TxnManager {
	return &TxnManager{txns: make(map[string]PinnedTxn)}
}

func (m *TxnManager) Begin(tabID string, txn PinnedTxn) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.txns[tabID]; ok {
		return fmt.Errorf("transaction already active on this tab")
	}
	m.txns[tabID] = txn
	return nil
}

func (m *TxnManager) Get(tabID string) (PinnedTxn, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	txn, ok := m.txns[tabID]
	return txn, ok
}

// Take atomically removes and returns the tab's transaction, so only one racing caller finalizes it.
func (m *TxnManager) Take(tabID string) (PinnedTxn, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	txn, ok := m.txns[tabID]
	if ok {
		delete(m.txns, tabID)
	}
	return txn, ok
}

// RollbackAll rolls back every open transaction. Called at shutdown.
func (m *TxnManager) RollbackAll() {
	m.mu.Lock()
	txns := m.txns
	m.txns = make(map[string]PinnedTxn)
	m.mu.Unlock()
	for _, txn := range txns {
		_ = txn.Rollback(context.Background())
		txn.Close()
	}
}
