package database

import (
	"context"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestQueryRegistryStartAndEnd(t *testing.T) {
	r := NewQueryRegistry()
	_, ctx, end := r.Start("c1", context.Background())
	if err := ctx.Err(); err != nil {
		t.Fatalf("ctx should be live, got %v", err)
	}
	end()
	if r.Cancel("c1") {
		t.Fatal("Cancel should return false after end()")
	}
}

func TestQueryRegistryCancelStopsContext(t *testing.T) {
	r := NewQueryRegistry()
	_, ctx, end := r.Start("c1", context.Background())
	defer end()
	if !r.Cancel("c1") {
		t.Fatal("Cancel should return true for live query")
	}
	select {
	case <-ctx.Done():
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected ctx to be cancelled")
	}
}

// Second Start on same connection must cancel first and fire its kill hook (releases pg backend PID, etc).
func TestQueryRegistryStartCancelsPreviousAndCallsKill(t *testing.T) {
	r := NewQueryRegistry()
	_, ctx1, end1 := r.Start("c1", context.Background())
	defer end1()
	var killed atomic.Int32
	r.SetKill("c1", func() { killed.Add(1) })

	_, ctx2, end2 := r.Start("c1", context.Background())
	defer end2()

	select {
	case <-ctx1.Done():
	case <-time.After(100 * time.Millisecond):
		t.Fatal("first ctx should be cancelled by second Start")
	}
	if killed.Load() != 1 {
		t.Fatalf("kill hook should fire exactly once, got %d", killed.Load())
	}
	if err := ctx2.Err(); err != nil {
		t.Fatalf("second ctx should still be live, got %v", err)
	}
}

func TestQueryRegistrySetKillNoOpForUnknownConn(t *testing.T) {
	r := NewQueryRegistry()
	r.SetKill("missing", func() { t.Fatal("kill should not run when no query is registered") })
}

func TestQueryRegistryEndIsIdempotent(t *testing.T) {
	r := NewQueryRegistry()
	_, _, end := r.Start("c1", context.Background())
	end()
	end() // must not panic or affect a later registration

	_, _, end2 := r.Start("c1", context.Background())
	defer end2()
	if r.Cancel("c1") != true {
		t.Fatal("new registration should be cancellable")
	}
}

// Stale end() must not evict a newer registration that took over the slot.
func TestQueryRegistryEndDoesNotEvictNewer(t *testing.T) {
	r := NewQueryRegistry()
	_, _, endOld := r.Start("c1", context.Background())
	_, _, endNew := r.Start("c1", context.Background())
	defer endNew()
	endOld()
	if !r.Cancel("c1") {
		t.Fatal("newer registration should still be cancellable after older end()")
	}
}

// A later Start must yield a strictly higher id than an earlier one (id order == cancel order).
func TestQueryRegistryStreamIDsIncreaseWithStartOrder(t *testing.T) {
	r := NewQueryRegistry()
	id1, _, end1 := r.Start("c1", context.Background())
	defer end1()
	id2, _, end2 := r.Start("c1", context.Background())
	defer end2()
	id3, _, end3 := r.Start("c2", context.Background())
	defer end3()

	n1, _ := strconv.Atoi(id1)
	n2, _ := strconv.Atoi(id2)
	n3, _ := strconv.Atoi(id3)
	if !(n1 < n2 && n2 < n3) {
		t.Fatalf("stream ids must increase with Start order: got %q, %q, %q", id1, id2, id3)
	}
}

func TestQueryRegistryConcurrent(t *testing.T) {
	r := NewQueryRegistry()
	var wg sync.WaitGroup
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, end := r.Start("c1", context.Background())
			end()
		}()
	}
	wg.Wait()
}
