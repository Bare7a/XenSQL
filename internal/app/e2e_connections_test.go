//go:build e2e

package app

import (
	"testing"

	"xensql/internal/database"
)

// TestE2ETestConnection covers the "Test connection" button: a good config pings
// successfully, and bad host/credentials fail fast instead of hanging.
func TestE2ETestConnection(t *testing.T) {
	for _, e := range allEngines() {
		e := e
		t.Run(e.name, func(t *testing.T) {
			if err := reachable(e); err != nil {
				t.Skipf("%s not reachable (%v) - bring the stack up with `make e2e-up`", e.name, err)
			}
			a := appForTest(t)

			if err := a.TestConnection(e.config()); err != nil {
				t.Fatalf("TestConnection on a good config: %v", err)
			}

			bad := e.config()
			bad.Password = "definitely-the-wrong-password"
			if err := a.TestConnection(bad); err == nil {
				t.Error("TestConnection with a wrong password should fail")
			}

			missing := e.config()
			missing.Port = 1 // nothing listens here
			if err := a.TestConnection(missing); err == nil {
				t.Error("TestConnection to a dead port should fail")
			}
		})
	}
}

// TestE2EConnectDisconnect covers the connection lifecycle the sidebar drives:
// Connect, IsConnected, GetConnectionStatus, then Disconnect.
func TestE2EConnectDisconnect(t *testing.T) {
	for _, e := range allEngines() {
		e := e
		t.Run(e.name, func(t *testing.T) {
			if err := reachable(e); err != nil {
				t.Skipf("%s not reachable (%v) - bring the stack up with `make e2e-up`", e.name, err)
			}
			a := appForTest(t)
			saved, err := a.SaveConnection(e.config())
			if err != nil {
				t.Fatalf("SaveConnection: %v", err)
			}

			if err := a.Connect(saved.ID); err != nil {
				t.Fatalf("Connect: %v", err)
			}
			if !a.IsConnected(saved.ID) {
				t.Fatal("IsConnected should be true after Connect")
			}
			status, err := a.GetConnectionStatus(saved.ID)
			if err != nil || !status.Connected {
				t.Fatalf("GetConnectionStatus = %+v, err = %v", status, err)
			}
			if status.Database == "" || status.User == "" {
				t.Errorf("status should report database and user, got %+v", status)
			}

			a.Disconnect(saved.ID)
			if a.IsConnected(saved.ID) {
				t.Fatal("IsConnected should be false after Disconnect")
			}
		})
	}
}

// TestE2EReadOnlyConnection checks read-only mode blocks writes (at the app gate
// and inside the driver) while still allowing reads - the defense-in-depth the
// README describes.
func TestE2EReadOnlyConnection(t *testing.T) {
	forEachEngine(t, func(t *testing.T, a *App, e engine, writableID string) {
		// Seed a table through the writable connection.
		table := uniqueTable("ro")
		createTempTable(t, a, e, writableID, e.autoPKTable(table), table)
		mustExec(t, a, writableID, "INSERT INTO "+qualified(e, table)+" (name) VALUES ('seed')")

		// A second, read-only connection to the same server.
		roCfg := e.config()
		roCfg.Name = e.name + "-readonly"
		roCfg.ReadOnly = true
		roSaved, err := a.SaveConnection(roCfg)
		if err != nil {
			t.Fatalf("save read-only connection: %v", err)
		}
		if err := a.Connect(roSaved.ID); err != nil {
			t.Fatalf("connect read-only: %v", err)
		}
		t.Cleanup(func() { a.Disconnect(roSaved.ID) })

		// Reads are allowed.
		if _, err := a.ExecuteQuery(roSaved.ID, "SELECT name FROM "+qualified(e, table)); err != nil {
			t.Errorf("SELECT on read-only connection should succeed: %v", err)
		}

		// Writes are blocked - both DML and DDL.
		writes := []string{
			"INSERT INTO " + qualified(e, table) + " (name) VALUES ('nope')",
			"UPDATE " + qualified(e, table) + " SET name = 'x'",
			"DELETE FROM " + qualified(e, table),
			"DROP TABLE " + qualified(e, table),
		}
		for _, w := range writes {
			if _, err := a.ExecuteQuery(roSaved.ID, w); err == nil {
				t.Errorf("write on read-only connection should be blocked: %q", w)
			}
		}

		// Row-level mutators must refuse directly too.
		if err := a.UpdateRow(roSaved.ID, database.RowUpdate{
			Schema: e.browseSchema, Table: table,
			PrimaryKey: map[string]interface{}{"id": 1},
			Changes:    map[string]interface{}{"name": "x"},
		}); err == nil {
			t.Error("UpdateRow on read-only connection should be blocked")
		}
		if _, err := a.InsertRow(roSaved.ID, e.browseSchema, table, map[string]interface{}{"name": "x"}); err == nil {
			t.Error("InsertRow on read-only connection should be blocked")
		}
		if _, err := a.DeleteRows(roSaved.ID, database.RowDelete{
			Schema: e.browseSchema, Table: table,
			PrimaryKeys: []map[string]interface{}{{"id": 1}},
		}); err == nil {
			t.Error("DeleteRows on read-only connection should be blocked")
		}

		// Confirm nothing was written: still exactly the seed row.
		if n := countRows(t, a, e, writableID, table); n != 1 {
			t.Errorf("read-only writes leaked: count = %d, want 1", n)
		}
	})
}
