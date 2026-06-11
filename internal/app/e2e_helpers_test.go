//go:build e2e

// E2E suite for package app.
//
// These tests exercise the full Wails App API - the exact methods the React
// frontend calls over the bindings - against real PostgreSQL, MySQL and MariaDB
// servers. They are gated behind the `e2e` build tag so the default `go test`
// (which only has embedded SQLite) never tries to reach a server.
//
// Bring the servers up with `task e2e:up` (see docker-compose.yml), then run
// `task e2e`. Connection details are read from the environment with defaults
// that match the compose file, so you can point the suite at any server:
//
//	XENSQL_E2E_PG_HOST / _PORT / _USER / _PASSWORD / _DB
//	XENSQL_E2E_MYSQL_HOST / _PORT / _USER / _PASSWORD / _DB
//	XENSQL_E2E_MARIADB_HOST / _PORT / _USER / _PASSWORD / _DB
//
// An engine that is not reachable is skipped (with a pointer to `task e2e:up`)
// rather than failing, so a partial local stack still runs the engines you have.
package app

import (
	"fmt"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"xensql/internal/database"
)

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// engine describes one database backend and the dialect knobs the cross-engine
// suite needs. Behaviour assertions are shared; only the SQL that differs per
// dialect lives here.
type engine struct {
	name   string
	driver database.DriverType

	// config returns the connection config pointed at the running server.
	config func() database.ConnectionConfig

	// browseSchema is the schema the grid browses by default (public for
	// Postgres, the database name for MySQL/MariaDB).
	browseSchema string

	// autoPKTable is a CREATE TABLE for a table with an auto-incrementing
	// integer primary key column named id and a text column named name.
	autoPKTable func(table string) string

	// jsonType is the column type used for JSON values (jsonb / json).
	jsonType string

	// nowExpr returns the current timestamp in a SELECT.
	nowExpr string

	// sleepSQL returns a statement that blocks the server for the given seconds,
	// used to test query cancellation.
	sleepSQL func(seconds int) string
}

func pgEngine() engine {
	db := envOr("XENSQL_E2E_PG_DB", "xensql_test")
	return engine{
		name:         "postgres",
		driver:       database.DriverPostgres,
		browseSchema: "public",
		jsonType:     "jsonb",
		nowExpr:      "now()",
		sleepSQL:     func(s int) string { return fmt.Sprintf("SELECT pg_sleep(%d)", s) },
		config: func() database.ConnectionConfig {
			return database.ConnectionConfig{
				Name:     "e2e-postgres",
				Driver:   database.DriverPostgres,
				Host:     envOr("XENSQL_E2E_PG_HOST", "127.0.0.1"),
				Port:     envInt("XENSQL_E2E_PG_PORT", 55432),
				Database: db,
				Username: envOr("XENSQL_E2E_PG_USER", "postgres"),
				Password: envOr("XENSQL_E2E_PG_PASSWORD", "postgres"),
				SSLMode:  "disable",
			}
		},
		autoPKTable: func(table string) string {
			return fmt.Sprintf(
				`CREATE TABLE %s (id SERIAL PRIMARY KEY, name TEXT NOT NULL)`, table)
		},
	}
}

func mysqlEngine() engine {
	db := envOr("XENSQL_E2E_MYSQL_DB", "xensql_test")
	return engine{
		name:         "mysql",
		driver:       database.DriverMySQL,
		browseSchema: db,
		jsonType:     "json",
		nowExpr:      "now()",
		sleepSQL:     func(s int) string { return fmt.Sprintf("SELECT SLEEP(%d)", s) },
		config: func() database.ConnectionConfig {
			return database.ConnectionConfig{
				Name:     "e2e-mysql",
				Driver:   database.DriverMySQL,
				Host:     envOr("XENSQL_E2E_MYSQL_HOST", "127.0.0.1"),
				Port:     envInt("XENSQL_E2E_MYSQL_PORT", 33306),
				Database: db,
				Username: envOr("XENSQL_E2E_MYSQL_USER", "root"),
				Password: envOr("XENSQL_E2E_MYSQL_PASSWORD", "root"),
			}
		},
		autoPKTable: func(table string) string {
			return fmt.Sprintf(
				`CREATE TABLE %s (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL)`, table)
		},
	}
}

func mariadbEngine() engine {
	db := envOr("XENSQL_E2E_MARIADB_DB", "xensql_test")
	return engine{
		name:         "mariadb",
		driver:       database.DriverMySQL, // MariaDB speaks the MySQL protocol/driver
		browseSchema: db,
		jsonType:     "json",
		nowExpr:      "now()",
		sleepSQL:     func(s int) string { return fmt.Sprintf("SELECT SLEEP(%d)", s) },
		config: func() database.ConnectionConfig {
			return database.ConnectionConfig{
				Name:     "e2e-mariadb",
				Driver:   database.DriverMySQL,
				Host:     envOr("XENSQL_E2E_MARIADB_HOST", "127.0.0.1"),
				Port:     envInt("XENSQL_E2E_MARIADB_PORT", 33307),
				Database: db,
				Username: envOr("XENSQL_E2E_MARIADB_USER", "root"),
				Password: envOr("XENSQL_E2E_MARIADB_PASSWORD", "root"),
			}
		},
		autoPKTable: func(table string) string {
			return fmt.Sprintf(
				`CREATE TABLE %s (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL)`, table)
		},
	}
}

func allEngines() []engine {
	return []engine{pgEngine(), mysqlEngine(), mariadbEngine()}
}

var (
	reachMu    sync.Mutex
	reachCache = map[string]error{}
)

// reachable reports whether the engine's server accepts a connection, so the
// suite can skip engines that aren't up instead of failing. The result is probed
// once per engine and cached: the first call absorbs a slow-starting server (a
// few retries), and every later call across the suite is instant.
func reachable(e engine) error {
	reachMu.Lock()
	defer reachMu.Unlock()
	if err, ok := reachCache[e.name]; ok {
		return err
	}
	err := probeReachable(e)
	reachCache[e.name] = err
	return err
}

func probeReachable(e engine) error {
	d, err := database.GetDriver(e.driver)
	if err != nil {
		return err
	}
	cfg := e.config()
	database.NormalizeConnectionConfig(&cfg)
	// A few retries smooth over a server that is up but still finishing init.
	var lastErr error
	for i := 0; i < 3; i++ {
		if lastErr = d.TestConnection(testCtx(), cfg); lastErr == nil {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return lastErr
}

// requireEngine connects the app to the engine and returns the saved connection
// id, skipping the test if the server is unreachable.
func requireEngine(t *testing.T, a *App, e engine) string {
	t.Helper()
	if err := reachable(e); err != nil {
		t.Skipf("%s not reachable (%v) - bring the stack up with `task e2e:up`", e.name, err)
	}
	saved, err := a.SaveConnection(e.config())
	if err != nil {
		t.Fatalf("[%s] save connection: %v", e.name, err)
	}
	if err := a.Connect(saved.ID); err != nil {
		t.Fatalf("[%s] connect: %v", e.name, err)
	}
	t.Cleanup(func() { a.Disconnect(saved.ID) })
	return saved.ID
}
