package app

import (
	"context"
	"fmt"
	"time"

	"xensql/internal/database"
)

// The tree fires these lazily; a saturated pool must not wedge the sidebar.
const schemaTimeout = 15 * time.Second

func (a *App) schemaContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(a.ctx, schemaTimeout)
}

func (a *App) ListIndexes(connectionID, schema, table string) ([]database.IndexInfo, error) {
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := a.schemaContext()
	defer cancel()
	return s.ListIndexes(ctx, schema, table)
}

func (a *App) ListConstraints(connectionID, schema, table string) ([]database.ConstraintInfo, error) {
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := a.schemaContext()
	defer cancel()
	return s.ListConstraints(ctx, schema, table)
}

func (a *App) ListTriggers(connectionID, schema, table string) ([]database.TriggerInfo, error) {
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := a.schemaContext()
	defer cancel()
	return s.ListTriggers(ctx, schema, table)
}

func (a *App) ListRoutines(connectionID, schema string) ([]database.RoutineInfo, error) {
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := a.schemaContext()
	defer cancel()
	return s.ListRoutines(ctx, schema)
}

// GetObjectDDL reads the catalog only, so it stays available on read-only connections.
func (a *App) GetObjectDDL(connectionID string, ref database.ObjectRef) (string, error) {
	if ref.Name == "" {
		return "", fmt.Errorf("object name is required")
	}
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return "", err
	}
	ctx, cancel := a.schemaContext()
	defer cancel()
	return s.ObjectDDL(ctx, ref)
}
