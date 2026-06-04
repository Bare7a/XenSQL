package database

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeSession stubs Session so Pool tests run without a real database.
type fakeSession struct {
	closed atomic.Bool
}

func (f *fakeSession) Close() error               { f.closed.Store(true); return nil }
func (f *fakeSession) Ping(context.Context) error { return nil }
func (f *fakeSession) DriverType() DriverType     { return "fake" }
func (f *fakeSession) Execute(context.Context, string) (*QueryResult, error) {
	return &QueryResult{}, nil
}
func (f *fakeSession) ExecuteStream(context.Context, string, StreamOpts) (*QueryResult, error) {
	return &QueryResult{}, nil
}
func (f *fakeSession) ListSchemas(context.Context) ([]SchemaInfo, error)       { return nil, nil }
func (f *fakeSession) ListTables(context.Context, string) ([]TableInfo, error) { return nil, nil }
func (f *fakeSession) ListColumns(context.Context, string, string) ([]ColumnInfo, error) {
	return nil, nil
}
func (f *fakeSession) QueryTable(context.Context, TableDataRequest) (*QueryResult, error) {
	return &QueryResult{}, nil
}
func (f *fakeSession) QueryTableStream(context.Context, TableDataRequest, StreamOpts) (*QueryResult, error) {
	return &QueryResult{}, nil
}
func (f *fakeSession) UpdateRow(context.Context, RowUpdate) error           { return nil }
func (f *fakeSession) DeleteRows(context.Context, RowDelete) (int64, error) { return 0, nil }
func (f *fakeSession) InsertRow(context.Context, string, string, map[string]interface{}) (map[string]interface{}, error) {
	return nil, nil
}
func (f *fakeSession) BeginTxn(context.Context) (PinnedTxn, error)    { return nil, nil }
func (f *fakeSession) PinnedConn(context.Context) (PinnedConn, error) { return nil, nil }
func (f *fakeSession) ConnectionInfo(context.Context) (ConnectionStatus, error) {
	return ConnectionStatus{}, nil
}

type fakeDriver struct {
	connectCalls atomic.Int32
	delay        time.Duration
}

func (d *fakeDriver) Type() DriverType { return "fake" }
func (d *fakeDriver) Connect(ctx context.Context, _ ConnectionConfig) (Session, error) {
	d.connectCalls.Add(1)
	if d.delay > 0 {
		select {
		case <-time.After(d.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return &fakeSession{}, nil
}
func (d *fakeDriver) TestConnection(context.Context, ConnectionConfig) error { return nil }

func registerFakeDriver(t *testing.T) *fakeDriver {
	t.Helper()
	d := &fakeDriver{}
	Register(d)
	return d
}

func TestPoolReusesSessionForSameFingerprint(t *testing.T) {
	d := registerFakeDriver(t)
	p := NewPool()
	cfg := ConnectionConfig{ID: "a", Driver: "fake", Host: "h"}
	for i := 0; i < 3; i++ {
		if err := p.Connect(context.Background(), cfg); err != nil {
			t.Fatalf("connect %d: %v", i, err)
		}
	}
	if got := d.connectCalls.Load(); got != 1 {
		t.Fatalf("driver Connect should run once for repeated identical configs, got %d", got)
	}
	if !p.IsConnected("a") {
		t.Fatal("pool should report connected")
	}
}

func TestPoolReconnectsWhenFingerprintChanges(t *testing.T) {
	d := registerFakeDriver(t)
	p := NewPool()
	cfg := ConnectionConfig{ID: "a", Driver: "fake", Host: "h1"}
	if err := p.Connect(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	first, _ := p.Session("a")
	cfg.Host = "h2"
	if err := p.Connect(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	if d.connectCalls.Load() != 2 {
		t.Fatalf("fingerprint change should force reconnect, got %d", d.connectCalls.Load())
	}
	if !first.(*fakeSession).closed.Load() {
		t.Fatal("old session should be Closed when superseded")
	}
}

// Two concurrent Connect calls for the same new ID must only open one session.
func TestPoolConnectIsSingleFlightPerID(t *testing.T) {
	d := registerFakeDriver(t)
	d.delay = 30 * time.Millisecond
	p := NewPool()
	cfg := ConnectionConfig{ID: "a", Driver: "fake", Host: "h"}

	var wg sync.WaitGroup
	const callers = 16
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := p.Connect(context.Background(), cfg); err != nil {
				t.Errorf("connect: %v", err)
			}
		}()
	}
	wg.Wait()
	if got := d.connectCalls.Load(); got != 1 {
		t.Fatalf("expected exactly one driver Connect under contention, got %d", got)
	}
}

func TestPoolDisconnectClosesSession(t *testing.T) {
	registerFakeDriver(t)
	p := NewPool()
	cfg := ConnectionConfig{ID: "a", Driver: "fake", Host: "h"}
	if err := p.Connect(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	sess, _ := p.Session("a")
	p.Disconnect("a")
	if !sess.(*fakeSession).closed.Load() {
		t.Fatal("Disconnect should Close the session")
	}
	if p.IsConnected("a") {
		t.Fatal("Disconnect should drop from pool")
	}
}

func TestPoolCloseAll(t *testing.T) {
	registerFakeDriver(t)
	p := NewPool()
	cfgs := []ConnectionConfig{
		{ID: "a", Driver: "fake", Host: "h"},
		{ID: "b", Driver: "fake", Host: "h"},
	}
	for _, c := range cfgs {
		if err := p.Connect(context.Background(), c); err != nil {
			t.Fatal(err)
		}
	}
	sessA, _ := p.Session("a")
	sessB, _ := p.Session("b")
	p.CloseAll()
	if !sessA.(*fakeSession).closed.Load() || !sessB.(*fakeSession).closed.Load() {
		t.Fatal("CloseAll should close every session")
	}
	if p.IsConnected("a") || p.IsConnected("b") {
		t.Fatal("CloseAll should empty the pool")
	}
}

func TestPoolSessionMissing(t *testing.T) {
	p := NewPool()
	if _, err := p.Session("nope"); err == nil {
		t.Fatal("expected error when session missing")
	}
}
