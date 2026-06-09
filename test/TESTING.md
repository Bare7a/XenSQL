# 🧪 Testing XenSQL

XenSQL has three test layers:

| Layer        | Command                       |   Needs servers?    | What it covers                                                                          |
| ------------ | ----------------------------- | :-----------------: | --------------------------------------------------------------------------------------- |
| **Frontend** | `cd frontend && npm test`     |         No          | React/TS logic - hooks, stores, grid, export, formatting (Vitest)                       |
| **Go unit**  | `make test`                   |         No          | Pure logic + the full app surface against embedded **SQLite**                           |
| **E2E**      | `make e2e-all`                | Yes (Docker/Podman) | The same Wails API the UI calls, against real **PostgreSQL**, **MySQL** and **MariaDB** |

---

## Frontend tests

The React/TypeScript suite runs with [Vitest](https://vitest.dev) and needs no servers:

```bash
cd frontend
npm test           # vitest run
npm run test:watch # watch mode
```

---

## Go unit tests

No setup - these use embedded SQLite and run in seconds:

```bash
make test          # go test ./internal/...
```

---

## End-to-end tests

The E2E suite drives the **exact Wails `App` methods the React frontend calls
over the bindings** (connect, run query, browse table, edit rows, transactions,
export, …) against real database servers started from
[`docker-compose.yml`](../docker-compose.yml).

### Requirements

- Docker with Compose v2 (`docker compose`) **or** Podman (`podman compose`)
- Go 1.26+

### Run it

One shot - bring the stack up, run the suite, tear it down:

```bash
make e2e-all
```

Or keep the servers running between iterations:

```bash
make e2e-up        # start postgres + mysql + mariadb, wait until healthy
make e2e           # run the suite (repeat as you edit tests)
make e2e-down      # stop and remove volumes
```

Using Podman? Point the compose command at it:

```bash
make e2e-all COMPOSE="podman compose"
```

### What the stack looks like

The compose file publishes each server on a **non-default port** so it never
collides with a database you already run locally:

| Engine     | Image         | Host port | Database      | User / Password         |
| ---------- | ------------- | :-------: | ------------- | ----------------------- |
| PostgreSQL | `postgres:16` |  `55432`  | `xensql_test` | `postgres` / `postgres` |
| MySQL      | `mysql:8.0`   |  `33306`  | `xensql_test` | `root` / `root`         |
| MariaDB    | `mariadb:11`  |  `33307`  | `xensql_test` | `root` / `root`         |

### Pointing the suite at other servers

Connection details are read from the environment, with defaults matching the
compose file. Override any of them to test against your own servers:

```
XENSQL_E2E_PG_HOST       XENSQL_E2E_PG_PORT       XENSQL_E2E_PG_USER
XENSQL_E2E_PG_PASSWORD   XENSQL_E2E_PG_DB
XENSQL_E2E_MYSQL_*       (HOST / PORT / USER / PASSWORD / DB)
XENSQL_E2E_MARIADB_*     (HOST / PORT / USER / PASSWORD / DB)
```

An engine that isn't reachable is **skipped** (not failed), so you can run the
suite with only some servers up:

```bash
go test -tags e2e -run TestE2EConnectivity -v ./internal/app/   # smoke test: which engines are reachable?
```

### What's covered

Every test runs against all three engines (`postgres`, `mysql`, `mariadb`):

- **Connections** - test connection (good/bad creds, dead port), connect /
  disconnect / status, read-only mode blocking writes at both the app gate and
  the driver
- **Schema explorer** - `LoadSchemaData`, schemas / tables / columns, primary-key,
  foreign-key and nullability detection, views
- **Query execution** - DDL / DML / SELECT lifecycle, affected-row counts, empty
  result sets, error surfacing, value normalization (bigints past 2⁵³ → string,
  `NULL` → nil, binary → hex, timestamps → RFC3339), `RETURNING`
- **Results grid** - browse with pagination, sort, filter, and rejection of
  injection-style filters
- **Editing data** - `InsertRow` (returns the generated key), `UpdateRow`,
  `DeleteRows`, and the no-primary-key safety rule
- **Streaming** - batched row delivery, streaming table browse, multi-statement
  scripts (one result set per statement), and stop-on-first-error
- **Transactions** - per-tab begin / commit / rollback, isolation from other
  connections, guard rails, and independent concurrent transactions per tab
- **Query history** - success/error recording and clearing
- **Export** - CSV / JSON / Markdown / SQL of live query results

### Implementation notes

- The E2E tests live in `internal/app/e2e_*_test.go` (package `app`, alongside the
  code they exercise), behind the `e2e` build tag, so the default `go test` never
  tries to reach a server.
- The streaming **App** methods (`ExecuteQueryStream`, `QueryTableStream`) push
  rows over Wails runtime events, which only exist in the live desktop runtime.
  The streaming tests therefore drive the engine those methods delegate to
  (`Session.ExecuteStream`, `Session.QueryTableStream`, `PinnedConn.ExecuteScript`),
  covering batching and multi-result behaviour minus only the event plumbing.

---

## Continuous integration

[`.github/workflows/test.yml`](../.github/workflows/test.yml) runs the frontend
suite, the Go unit suite, and the full E2E suite (all three engines, via the same
compose file) on every push to `master` and every pull request.
