# Contributing to Kaizen

Thank you for your interest in contributing! This document explains how to get started.

---

## Ways to Contribute

- **Bug reports** — use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- **Feature requests** — use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- **Pull requests** — bug fixes, new events, platform improvements, documentation

---

## Development Setup

Requirements: `sqlite3`, `bash` (or Git Bash on Windows), `pwsh` / PowerShell 5.1+.

```bash
git clone https://github.com/yldgio/copilot-kaizen.git
cd copilot-kaizen
```

No build step — the scripts are plain Bash and PowerShell. Install the plugin locally to test:

```bash
copilot plugin install /path/to/copilot-kaizen
```

### Testing the hook scripts manually

```bash
# Simulate a sessionStart event
echo '{"source":"new","cwd":"/tmp/test"}' | bash hooks/kaizen/kaizen.sh sessionStart

# Simulate an error event
echo '{"error":{"name":"TestError","message":"something failed"},"cwd":"/tmp/test"}' \
  | bash hooks/kaizen/kaizen.sh errorOccurred
```

PowerShell equivalent:

```powershell
'{"source":"new","cwd":"C:\\tmp\\test"}' | pwsh hooks/kaizen/kaizen.ps1 -Event sessionStart
```

---

## Pull Request Guidelines

1. **One concern per PR.** Keep changes focused.
2. **Test on both scripts.** If you change logic, update both `kaizen.sh` and `kaizen.ps1`.
3. **Update CHANGELOG.md.** Add an entry under `[Unreleased]`.
4. **Keep hooks non-blocking.** All SQLite writes must remain in background processes.
5. **Exit 0 on failure.** Hooks must never block or crash the agent.

---

## Code Style

- Bash: `set -euo pipefail`, `trap 'exit 0' ERR`, snake_case functions prefixed `_`
- PowerShell: `$ErrorActionPreference = 'SilentlyContinue'`, PascalCase functions
- SQL: uppercase keywords, one clause per line
- Comments only where intent is non-obvious

---

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
feat: add support for toolDenied result type
fix: prevent session file collision on concurrent sessions
docs: add manual observation insertion examples
```

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating, you agree to abide by its terms.
