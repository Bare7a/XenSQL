package app

import (
	"context"

	"xensql/internal/database"
)

// ExplainQuery returns a normalized plan for one statement. analyze executes the statement, so a
// write runs inside a transaction that is always rolled back; a tab with an open transaction runs
// there instead, matching where a plain Run would have.
func (a *App) ExplainQuery(connectionID, tabID, sql string, analyze bool) (*database.QueryPlan, error) {
	cfg, err := a.getConnection(connectionID)
	if err != nil {
		return nil, err
	}
	stmt, err := database.SingleStatement(cfg.Driver, sql)
	if err != nil {
		return nil, err
	}
	if cfg.ReadOnly {
		if err := database.AssertReadOnlySQLFor(cfg.Driver, stmt); err != nil {
			return nil, err
		}
	}

	_, queryCtx, end := a.queryContext(connectionID)
	defer end()

	conn, note, release, err := a.explainConn(queryCtx, tabID, connectionID, cfg.Driver, stmt, analyze)
	if err != nil {
		return nil, err
	}
	if release != nil {
		defer release()
	}
	plan, err := database.ExplainPlan(queryCtx, conn, cfg.Driver, stmt, analyze)
	if err != nil {
		return nil, queryErr(err)
	}
	if note != "" {
		plan.AddNote(note)
	}
	return plan, nil
}

// explainConn picks the connection and the note recording which: the tab's transaction, a throwaway
// one when a measured plan would otherwise execute a write, or a plain pinned connection.
func (a *App) explainConn(ctx context.Context, tabID, connectionID string, driver database.DriverType, stmt string, analyze bool) (database.PinnedConn, string, func(), error) {
	if txn, ok := a.txns.Get(tabID); ok {
		return txn, database.PlanNoteTabTransaction, nil, nil
	}
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, "", nil, err
	}
	if analyze && !database.IsReadOnlySQLFor(driver, stmt) {
		txn, err := s.BeginTxn(ctx)
		if err != nil {
			return nil, "", nil, err
		}
		release := func() {
			// Detached from ctx: a cancelled plan must still roll back before the conn returns to the pool.
			_ = txn.Rollback(context.WithoutCancel(ctx))
			txn.Close()
		}
		return txn, database.PlanNoteRolledBack, release, nil
	}
	pc, err := s.PinnedConn(ctx)
	if err != nil {
		return nil, "", nil, err
	}
	return pc, "", pc.Close, nil
}
