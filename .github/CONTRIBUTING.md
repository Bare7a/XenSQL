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
- [Wails v2](https://wails.io/docs/gettingstarted/installation)
- Node.js 24+

### Setup Commands

```bash
# Install Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Frontend dependencies
cd frontend
npm install
cd ..

# Run in dev mode
wails dev
