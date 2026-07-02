package database

import (
	"context"
	"fmt"
	"sync"
)

type Driver interface {
	Type() DriverType
	Connect(ctx context.Context, cfg ConnectionConfig) (Session, error)
	TestConnection(ctx context.Context, cfg ConnectionConfig) error
}

type Session interface {
	Close() error
	Ping(ctx context.Context) error
	Execute(ctx context.Context, sql string) (*QueryResult, error)
	// Returned QueryResult carries metadata only; rows are delivered via OnBatch. Non-SELECT acts like Execute.
	ExecuteStream(ctx context.Context, sql string, opts StreamOpts) (*QueryResult, error)
	// BeginTxn checks out a dedicated connection, issues BEGIN, and returns a PinnedTxn that must be
	// Committed or Rolled back by the caller, then Closed.
	BeginTxn(ctx context.Context) (PinnedTxn, error)
	// PinnedConn checks out a dedicated connection (with the session's setup applied) for running a
	// multi-statement script on one connection. The caller must Close it.
	PinnedConn(ctx context.Context) (PinnedConn, error)
	ListSchemas(ctx context.Context) ([]SchemaInfo, error)
	ListTables(ctx context.Context, schema string) ([]TableInfo, error)
	ListColumns(ctx context.Context, schema, table string) ([]ColumnInfo, error)
	QueryTable(ctx context.Context, req TableDataRequest) (*QueryResult, error)
	QueryTableStream(ctx context.Context, req TableDataRequest, opts StreamOpts) (*QueryResult, error)
	UpdateRow(ctx context.Context, upd RowUpdate) error
	DeleteRows(ctx context.Context, del RowDelete) (int64, error)
	InsertRow(ctx context.Context, schema, table string, values map[string]any) (map[string]any, error)
	ConnectionInfo(ctx context.Context) (ConnectionStatus, error)
	DriverType() DriverType
}

var (
	registry   = map[DriverType]Driver{}
	registryMu sync.RWMutex
)

func Register(d Driver) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry[d.Type()] = d
}

func GetDriver(t DriverType) (Driver, error) {
	registryMu.RLock()
	defer registryMu.RUnlock()
	d, ok := registry[t]
	if !ok {
		return nil, fmt.Errorf("unsupported driver: %s", t)
	}
	return d, nil
}

// ConnectAndPing is the shared Driver.TestConnection implementation: open a real session, ping it,
// close it.
func ConnectAndPing(ctx context.Context, d Driver, cfg ConnectionConfig) error {
	s, err := d.Connect(ctx, cfg)
	if err != nil {
		return err
	}
	defer s.Close()
	return s.Ping(ctx)
}
