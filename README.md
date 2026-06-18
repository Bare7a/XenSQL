# ⚡ XenSQL

![Go](https://img.shields.io/badge/Go-1.26+-00ADD8?style=for-the-badge&logo=go)
![Wails](https://img.shields.io/badge/Wails-v3--alpha-4B275F?style=for-the-badge)
![License](https://img.shields.io/badge/license-GPL--3.0-blue?style=for-the-badge)
![Status](https://img.shields.io/badge/status-active-success?style=for-the-badge)

> **A fast, local-first SQL workbench built with Go + Wails.**

No cloud. No accounts. No telemetry.  
Just a focused, native desktop tool for working with databases.

---

## ⬇️ Download

Grab the latest build for **Windows**, **macOS**, or **Linux** from the [**Releases**](../../releases/latest) page - no installer, no account, just download and run.

Prefer to build it yourself? See **Installation & Development** below.

---

## 🚀 Try it in seconds

```bash
wails3 task build
```

Or during development:

```bash
wails3 dev
```

---

## ⚡ SQL tools are usually overkill. XenSQL isn’t.

Work with **SQLite**, **PostgreSQL**, and **MySQL / MariaDB** in a single fast desktop app that runs entirely on your machine.

🧳 Portable  
⚡ Fast startup  
🔒 Local-first  
🧠 Developer-focused

---

### 👉 Everything you need. Nothing you don’t.

- Query faster with smart, schema-aware autocomplete
- Stream results - rows arrive as the driver yields them
- Run multi-statement scripts and get a result tab per output
- Explore schemas instantly
- Save and reuse queries
- Export anything in one click

---

## 🖥️ Screenshots

<table>
  <tr>
    <td align="center"><img src=".github/screenshots/1.png?raw=true" width="100%"><br><sub><b>Editor</b> - autocomplete · streaming results · JSON row view</sub></td>
    <td align="center"><img src=".github/screenshots/2.png?raw=true" width="100%"><br><sub><b>Transactions & multiple results</b> - per-tab begin/commit/rollback · a result tab per statement</sub></td>
    <td align="center"><img src=".github/screenshots/3.png?raw=true" width="100%"><br><sub><b>Table data</b> - browse rows; stage edits before apply</sub></td>
  </tr>
  <tr>
    <td align="center"><img src=".github/screenshots/4.png?raw=true" width="100%"><br><sub><b>Cell editor</b> - JSON, XML, HTML, or text with beautify</sub></td>
    <td align="center"><img src=".github/screenshots/5.png?raw=true" width="100%"><br><sub><b>Grid</b> - row/column select, context menu, export</sub></td>
    <td align="center"><img src=".github/screenshots/6.png?raw=true" width="100%"><br><sub><b>Export</b> - CSV, JSON, Markdown, or SQL inserts</sub></td>
  </tr>
  <tr>
    <td align="center"><img src=".github/screenshots/7.png?raw=true" width="100%"><br><sub><b>Connections</b> - SSL, read-only mode, tab colors</sub></td>
    <td align="center"><img src=".github/screenshots/8.png?raw=true" width="100%"><br><sub><b>Quick Search</b> - <code>Ctrl+P</code> for tabs, tables, queries</sub></td>
    <td align="center"><img src=".github/screenshots/9.png?raw=true" width="100%"><br><sub><b>Appearance</b> - dark or light theme, zoom, language support</sub></td>
  </tr>
</table>

---

## ⚡ What XenSQL is

XenSQL is a **desktop SQL client built for developers who want speed, clarity, and control**.

It combines:

- ⚡ Go backend for performance
- 🖥️ Wails for native desktop packaging (uses the OS webview)
- ⚛️ React + TypeScript UI
- ✍️ Monaco Editor for a real IDE-like SQL experience

---

## 🚨 Why it exists

Most SQL tools today are:

- heavy Electron apps
- cloud-connected by default
- tied to subscriptions or accounts
- overloaded with features you don’t use

XenSQL focuses on one thing:

> **A fast, local environment for working with databases.**

---

# ⚡ Features

## 🗄️ Supported Databases

| Database | Read & write | Read-only mode | Secure transport | Notes |
|----------|:------------:|:--------------:|:-----------------|-------|
| **PostgreSQL** | ✅ | ✅ | SSL - `disable` / `require` / `verify-full` | via pgx |
| **MySQL** | ✅ | ✅ | TLS | |
| **MariaDB** | ✅ | ✅ | TLS | MySQL-compatible |
| **SQLite** | ✅ | ✅ | local file | file-picker workflow |

---

## 🔌 Connections

- Create, edit, test, and manage database connections
- Organize into **folders** with drag-and-drop reorder
- Per-connection **tab colors**
- **Read-only mode** with defense-in-depth - blocked at both the Wails layer and inside each driver
- PostgreSQL SSL (`disable` / `require` / `verify-full`) and MySQL TLS
- SQLite file picker workflow

---

## 🧠 SQL Editor

- **Tabbed** workspace with drag-and-drop tabs and **session restore**
- Monaco-powered editing with custom dark/light themes
- **Smart autocomplete** - substring + prefix matching, context-aware (`SELECT` / `FROM` / `JOIN` / `WHERE` / `UPDATE` / `DELETE` / `INSERT`), `schema.table.column` dot completion, quoted identifiers and aliases
- Built-in **snippets** - `JOIN`, `SELECT * FROM`, aggregate functions
- Driver-correct identifier quoting (PostgreSQL, MySQL, SQLite)
- **Run selection** (`Ctrl+Enter`) / **run all** (`Ctrl+Shift+Enter`) / **stop** long-running queries
- **Streaming results** - rows render as the driver yields them
- **Multi-statement scripts** - run several `;`-separated statements at once; they execute in order on one connection, so temp tables, `SET`, and scripted `BEGIN` / `COMMIT` hold
- **Multiple result outputs** - a script or stored procedure that returns several result sets shows each in its own switchable result tab; a failing statement reports its error and stops the run
- **Pinned transactions** per tab - run `BEGIN` / `COMMIT` / `ROLLBACK` as SQL or from the toolbar; queries run inside the open transaction until you commit or roll back
- `UPDATE` / `DELETE` / `INSERT` with **`RETURNING`** flow back to the Results Grid
- Gutter icons to run individual statements
- Right-click menu with **format SQL**
- **Remappable keyboard shortcuts**

---

## 🗃️ Schema Explorer

- Tree view: schemas → tables → columns
- Search tables and columns instantly
- **Double-click** a table → `SELECT` in a new tab
- **Ctrl+double-click** → browse table data in the grid (editable when primary keys exist)
- Refresh schema on demand

---

## 📊 Results Grid

- **Virtualized** grid - smooth scroll over thousands of rows
- **Result-set tabs** - switch between outputs when a run returns multiple result sets
- **Sortable** columns with auto-sized widths and per-tab persistence
- **Keyboard-first** navigation (arrows, Shift+select, Enter for cell viewer)
- Column/row selection with Ctrl+click and Shift+click; `Ctrl+C` copies as TSV
- **Cell editor** for large values - JSON, XML, HTML, or plain text; beautify/minify; editable in table view
- **JSON / JSONB** auto-parsed in cell and side viewer
- Side **JSON row viewer** with filter / regex search, synced to focused row

---

## ✏️ Editing Data

View and modify table data directly in the grid - no hand-written `UPDATE` / `DELETE` (writable connections):

- **Browse** any table's rows (`Ctrl+double-click` a table in the Schema Explorer)
- **Inline edit** cells in place - changes are staged, then applied on demand
- **Insert** new rows and **bulk-delete** selected ones
- Safe by design: edits require a primary key, and **read-only** connections are blocked at both the Wails layer and inside the driver
- `INSERT` / `UPDATE` / `DELETE … RETURNING` results flow straight back into the grid

---

## 📚 Query Library & History

- **Saved queries** - name, filter, sort, link tabs with dirty-state tracking
- Save, update, rename, and delete from the sidebar or toolbar
- **Per-connection query history** with success/error and duration
- Clear history per connection or delete individual entries

---

## 📤 Export

- **CSV** / **JSON** / **Markdown** / **SQL INSERT**
- Export all or **selected** rows and columns
- Copy to clipboard or **save to file**
- Remembers your last export format

---

## 🌍 UX

- **Dark & light** themes
- **English**, **Deutsch**, and **Български**
- **Quick Search palette** (`Ctrl+P`) - jump to connections, saved queries, history, tabs
- Custom shortcuts editor + keyboard tips
- Frameless native title bar

---

## ⌨️ Keyboard Shortcuts

Every shortcut is remappable in the in-app shortcuts editor.

| Action | Shortcut |
|--------|----------|
| Quick Search palette | `Ctrl/⌘ + P` |
| Run selection | `Ctrl/⌘ + Enter` |
| Run all statements | `Ctrl/⌘ + Shift + Enter` |
| Save query | `Ctrl/⌘ + S` |
| Rename saved query | `F2` |
| New / close tab | `Ctrl/⌘ + T` / `Ctrl/⌘ + W` |
| Next / previous tab | `Ctrl/⌘ + Tab` / `Ctrl/⌘ + Shift + Tab` |
| Toggle sidebar / JSON panel | `Ctrl/⌘ + B` / `Ctrl/⌘ + J` |
| Zoom in / out / reset | `Ctrl/⌘ + =` / `Ctrl/⌘ + -` / `Ctrl/⌘ + 0` |
| Editor font size + / − | `Ctrl/⌘ + Shift + .` / `Ctrl/⌘ + Shift + ,` |
| Fullscreen | `F11` |

---

# 🧳 Portable by Design

Everything lives in a single **`XenSQL-data/`** folder:

```text
XenSQL(.exe)
XenSQL-data/
  connections.json
  editor_session.json
  query_history.json
  saved_queries.json
  settings.json
```

`settings.json` keeps your UI preferences - theme, language, layout, and keyboard shortcuts.

When the app sits somewhere writable, that folder is created **right next to the executable** (beside the `.app` bundle on macOS) - move it to a USB stick, network drive, or another PC and it just works.

If the app lives in a read-only location (e.g. `/Applications` or a system path), it falls back to the OS per-user data directory instead:

- **macOS** → `~/Library/Application Support/XenSQL-data`
- **Linux** → `~/.config/XenSQL-data`
- **Windows** → `%AppData%\XenSQL-data`

Override the location with `XENSQL_DATA_DIR`. During `wails3 dev` it's `./XenSQL-data` in the project root.

---

# 🖥️ Built with Wails

XenSQL uses **[Wails v3](https://v3.wails.io/)**, which embeds a web UI into a native desktop app.

- Go runs backend logic
- UI runs in the OS-native webview:
  - **Windows** → WebView2
  - **macOS** → WebKit
  - **Linux** → WebKitGTK
- No bundled Chromium like Electron

---

# ⚙️ Installation & Development

## Requirements

- Go 1.26+
- [Wails v3](https://v3.wails.io/) CLI (`wails3`)
- Node.js 24.16+

## Dev setup

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@latest

# wails3 dev installs frontend deps, generates bindings, and launches the app
wails3 dev
```

## Build

```bash
wails3 task build       # or: wails3 task package  (platform bundle/installer)
```

Output:

```text
bin/XenSQL(.exe)        # bin/XenSQL.app on macOS
```

---

# 🧱 Project Structure

```text
├── main.go                # Wails entry point (embeds frontend/dist)
├── docker-compose.yml     # PostgreSQL / MySQL / MariaDB for the E2E suite
├── Taskfile.yml           # dev tasks: build / test / e2e (run via `task` or `wails3 task`)
├── internal/
│   ├── app/               # Wails App API bindings + tests (connections, query, history, …)
│   ├── database/          # Driver interface + SQLite / PostgreSQL / MySQL
│   ├── storage/           # JSON persistence (incl. settings.json)
│   ├── paths/             # Portable data directory
│   └── service/           # SQL format, export helpers
└── frontend/              # React + TypeScript + Monaco (Vitest tests)
```

---

# 🧰 Tech Stack

| Layer      | Technology                                                                  |
| ---------- | --------------------------------------------------------------------------- |
| Backend    | [Go](https://go.dev/)                                                       |
| Desktop    | [Wails v3](https://v3.wails.io/)                                            |
| UI         | [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| Editor     | [Monaco Editor](https://microsoft.github.io/monaco-editor/)                 |
| PostgreSQL | [pgx](https://github.com/jackc/pgx)                                         |
| MySQL      | [go-sql-driver/mysql](https://github.com/go-sql-driver/mysql)               |
| SQLite     | [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite)                 |
| Tables     | [TanStack Virtual](https://tanstack.com/virtual)                            |
| State      | [Zustand](https://zustand-demo.pmnd.rs/)                                    |
| Icons      | [Lucide](https://lucide.dev/)                                               |
| i18n       | [i18next](https://www.i18next.com/)                                         |

---

# 📄 License

See [LICENSE](LICENSE).
