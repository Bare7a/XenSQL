# 🧪 Testing XenSQL

XenSQL has four test layers:

| Layer        | Command                       |   Needs servers?    | CI? | What it covers                                                                          |
| ------------ | ----------------------------- | :-----------------: | :-: | --------------------------------------------------------------------------------------- |
| **Frontend** | `cd frontend && npm test`     |         No          | Yes | React/TS logic - hooks, stores, grid, export, formatting (Vitest)                       |
| **Go unit**  | `task test`                   |         No          | Yes | Pure logic + the full app surface against embedded **SQLite**                           |
| **API E2E (Go)** | `task e2e:go:all`             | Yes (Docker/Podman) | Yes | The same Wails API the UI calls, against real **PostgreSQL**, **MySQL** and **MariaDB** |
| **UI E2E**       | `task e2e:ui:all`             | Yes (Docker/Podman) | No  | Full browser UI via Playwright + Wails server mode (all four drivers)                   |

> **On Linux**, both Go suites compile the native Wails layer, so they need the
> GTK4 + WebKitGTK 6.0 dev libraries:
> `sudo apt install libgtk-4-dev libwebkitgtk-6.0-dev`. 
> No native libraries are needed on macOS or Windows.

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
task test          # go test ./internal/...
```

---

## API end-to-end tests (Go)

The API E2E suite drives the **exact Wails `App` methods the React frontend calls
over the bindings** (connect, run query, browse table, edit rows, transactions,
export, …) against real database servers started from
[`docker-compose.yml`](../docker-compose.yml).

### Requirements

- Docker with Compose v2 (`docker compose`) **or** Podman (`podman compose`)
- Go 1.26+

### Run it

One shot - bring the stack up, run the suite, tear it down:

```bash
task e2e:go:all
```

Or keep the servers running between iterations:

```bash
task e2e:up        # start postgres + mysql + mariadb, wait until healthy
task e2e:go        # run the suite (repeat as you edit tests)
task e2e:down      # stop and remove volumes
```

Using Podman? Point the compose command at it:

```bash
task e2e:go:all COMPOSE="podman compose"
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

## UI end-to-end tests (Playwright)

The Playwright suite drives the **real XenSQL UI in a browser** against the
**real Go backend** in Wails v3 server mode (HTTP + WebSocket, no native window).
It lives entirely under [`e2e/`](../e2e/) and covers connections, schema, queries,
transactions, table view, results grid, editor autocomplete, and app-shell toggles
across **PostgreSQL**, **MySQL**, **MariaDB**, and **SQLite**.

### Requirements

- Everything from [API E2E (Go)](#api-end-to-end-tests-go) (Docker/Podman stack)
- Node.js 24+
- On Windows: WSL (server mode does not compile natively on Windows yet; the
  launcher runs the Go binary through WSL)

### Run it

One shot - install browsers (first time), bring the stack up, run the suite, tear
it down:

```bash
task e2e:ui:install   # first time only
task e2e:ui:all
```

Or keep the servers running between iterations:

```bash
task e2e:up
task e2e:ui           # repeat as you edit tests
task e2e:down
```

From the `e2e/` package directly:

```bash
cd e2e
npm install
npx playwright install chromium
npm run e2e
```

### Suite layout

```
e2e/
  playwright.config.ts    config; starts the app via `npm run e2e:server`
  global-setup.ts         brings the database stack up if it isn't already
  e2e-server.mjs          builds the frontend, then runs `go run -tags server ./cmd/e2e-server`
  pages/                  page objects, one per app surface
  support/
    fixtures.ts           the `test` every spec imports: page-object fixtures + `seed`
    databases.ts          the driver matrix (POSTGRES / MYSQL / MARIADB / SQLITE)
    seed.ts               Seeder: create + populate a uniquely-named table through the UI
  specs/                  grouped by surface: editor/, results/, sidebar/, table-view/,
                          plus app-shell and connections at the root
```

Specs import shared code via the `@support/*` alias (see `tsconfig.json`), so nesting
depth never changes an import. Tests that need data use the `seed` fixture —
`seed.table()` creates (and optionally fills) a uniquely-named table via the editor,
`seed.browseTable()` additionally opens it in the data browser. The default seeded
schema is `(id INTEGER PRIMARY KEY, name VARCHAR(50))`; keep seed SQL portable, since
the matrix suites replay it on all four drivers.

### What's covered

- **Connections** - add, test, connect, disconnect, edit, delete, drag-reorder
- **Schema & DDL** - create table, refresh, expand columns
- **Schema actions** - "SELECT in new tab" and "Count rows" (context menu, run + verify),
  click-a-column-to-insert into the editor
- **Queries** - single/multi-statement, run selection, error surfacing
- **Transactions** - rollback vs commit with row-count verification
- **Results grid** - column sort; cell / range / column / row selection; JSON viewer
- **Editor tabs** - open (`+`), switch (`Ctrl+Tab` / `Ctrl+Shift+Tab`), close (`Ctrl+W` / ✕)
- **Table view (browse)** - browse data; sort; scroll-paginate past the first 100 rows
- **Table view (edit)** - inline edit, set NULL, mark row for delete, Reset / Apply
  (verified against the DB), and undo / redo (`Ctrl+Z` / `Ctrl+Shift+Z`)
- **Table view (data ops)** - filter by a condition; add a row via the Add-row dialog
- **Cell viewer** - open a JSON cell with `Shift+Enter`, Beautify / Minify, Set to NULL
- **JSON viewer** - `Ctrl+J` toggle, mirrors the focused row, key filter, JSON nesting
- **Saved queries** - open into a tab, rename, delete, pin
- **Query history** - open into the editor, delete an entry, clear all
- **Sidebar** - schema search/filter; saved-query filter and sort; query-history filter
- **Export** - the *Export as* dialog (format, row/column scope, live summary). The
  actual *Save to file* (native OS dialog) and clipboard copy (Wails clipboard) aren't
  driven in a headless browser.
- **Editor** - autocomplete, save query, query history
- **App shell** - sidebar and JSON panel toggles

> Most feature tests run against **PostgreSQL** only (single-driver UI behaviour);
> the connection / query / schema / transaction / browse suites still run across all
> four drivers.

**When to run it:** before merging UI-facing changes (sidebar, editor, connections,
results grid, table view, tabs, etc.) or when touching `e2e/`, `cmd/e2e-server/`, or
server-mode event handling in `internal/app/`.

---

## Continuous integration

[`.github/workflows/test.yml`](../.github/workflows/test.yml) runs on every push
to `master` and every pull request:

- **Frontend** - Biome, type-check, build, Vitest
- **Go unit** - `task test` + `task build:check`
- **API E2E (Go)** - full three-engine suite via the same `docker-compose.yml`

**Playwright UI E2E is not in CI** (see [UI end-to-end tests](#ui-end-to-end-tests-playwright)).
Run `task e2e:ui:all` locally when your change touches the UI.
