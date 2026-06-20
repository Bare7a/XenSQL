# 🤝 Contributing to XenSQL

Thanks for considering contributing to **XenSQL**! 🎉  
We welcome all kinds of contributions - bug reports, feature ideas, documentation, code, translations, and more.

---

## 🛠️ Quick Start

1. **Fork** the repo and clone your fork
2. Follow the **[Development Setup](#-development-setup)** below
3. Create a branch: `git checkout -b feature/amazing-thing`
4. Make your changes
5. Test thoroughly (especially across SQLite, PostgreSQL, and MySQL)
6. Open a **Pull Request** using our [PR template](.github/PULL_REQUEST_TEMPLATE.md)

---

## ⚙️ Development Setup

### Requirements

- Go 1.26+
- [Wails v3](https://v3.wails.io/) CLI (`wails3`)
- Node.js 24+
- On Linux: `libgtk-4-dev libwebkitgtk-6.0-dev` (GTK4 + WebKitGTK 6.0)

### Setup Commands

```bash
# Install the Wails v3 CLI (bundles the Task runner used below)
go install github.com/wailsapp/wails/v3/cmd/wails3@latest

# Frontend dependencies
cd frontend
npm install
cd ..

# Run in dev mode
wails3 task dev
```

---

## 🧪 Testing

Before opening a PR, run the tests. See **[TESTING.md](./TESTING.md)** for full details.

```bash
# Frontend tests (React/TypeScript, Vitest)
cd frontend && npm test && cd ..

# Fast Go unit tests (embedded SQLite, no servers needed)
task test

# End-to-end tests against real PostgreSQL, MySQL and MariaDB
# (spins up the docker-compose.yml stack, runs the suite, tears it down)
task e2e:all
```

CI runs all three suites on every pull request.
