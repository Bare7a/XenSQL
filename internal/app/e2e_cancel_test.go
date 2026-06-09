//go:build e2e

package app

import (
	"testing"
	"time"
)

// TestE2ECancelQuery covers "stop long-running queries": a query that would block
// for a long time is aborted promptly by CancelQuery, returning an error instead
// of running to completion.
func TestE2ECancelQuery(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, connID string) {
		const sleepSeconds = 30

		type outcome struct {
			err     error
			elapsed time.Duration
		}
		done := make(chan outcome, 1)
		go func() {
			start := time.Now()
			_, err := a.ExecuteQuery(connID, e.sleepSQL(sleepSeconds))
			done <- outcome{err, time.Since(start)}
		}()

		// Give the query time to start and register its server-side kill handle.
		time.Sleep(700 * time.Millisecond)
		if !a.CancelQuery(connID) {
			t.Fatal("CancelQuery returned false - no in-flight query was registered")
		}

		select {
		case res := <-done:
			if res.err == nil {
				t.Fatalf("cancelled query should return an error, but it completed in %s", res.elapsed)
			}
			// It must abort promptly, nowhere near the full sleep.
			if res.elapsed > (sleepSeconds/2)*time.Second {
				t.Errorf("cancelled query took %s; expected a prompt abort", res.elapsed)
			}
		case <-time.After(time.Duration(sleepSeconds) * time.Second):
			t.Fatal("cancelled query did not return - CancelQuery did not abort it")
		}
	})
}
