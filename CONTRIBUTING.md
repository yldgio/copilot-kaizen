# Contributing to Kaizen

Thank you for your interest in contributing! This document explains how to get started.

---

## Ways to Contribute

- **Bug reports** — use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- **Feature requests** — use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- **Pull requests** — bug fixes, new events, platform improvements, documentation

---

## Development Setup

Requirements: Node.js 18+, npm, `bash` (or Git Bash on Windows), `pwsh` / PowerShell 5.1+.

```bash
git clone https://github.com/yldgio/copilot-kaizen.git
cd copilot-kaizen
npm install
```

Install globally from source to test the CLI:

```bash
npm install -g .
kaizen install .
```

### Testing the hook dispatcher manually

```bash
# Simulate a sessionStart event
echo '{"source":"new","cwd":"'$(pwd)'"}' | node bin/kaizen.mjs hook sessionStart

# Simulate an error event
echo '{"error":{"name":"TestError","message":"something failed"},"cwd":"'$(pwd)'"}' \
  | node bin/kaizen.mjs hook errorOccurred
```

PowerShell equivalent:

```powershell
'{"source":"new","cwd":"' + $PWD + '"}' | node bin/kaizen.mjs hook sessionStart
```

---

## Pull Request Guidelines

1. **One concern per PR.** Keep changes focused.
2. **Test changes.** Run `npm test` before submitting.
3. **Update CHANGELOG.md.** Add an entry under `[Unreleased]`.
4. **Keep preToolUse fast.** It has a 2s timeout. All DB writes use synchronous sql.js — only preToolUse uses `setImmediate` to defer its write off the critical path.
5. **Fail silently.** Extension handlers must never block or crash the agent.

---

## Code Style

- JavaScript (`.mjs`): ESM modules, async/await, JSDoc on exported functions
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
