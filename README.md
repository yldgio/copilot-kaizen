# Kaizen — Copilot CLI Plugin

> *改善* — continuous improvement

AI coding sessions are amnesiac by default. Each session starts fresh — no memory of what worked, what broke, which tools you reach for most, or what patterns your team has settled on. **Kaizen** fixes that.

Kaizen hooks into the Copilot CLI event system and builds a persistent, compounding memory across every session. Errors accumulate into patterns. Patterns crystallize into procedures. Procedures feed back into the next session — tightening the loop over time.

```
Observe → Reflect → Improve → Observe better
   ↑                                   │
   └───────────────────────────────────┘
```

---

## Install

### As a Copilot CLI Plugin (recommended)

```bash
copilot plugin install YOUR_GITHUB_USER/copilot-hooks
```

Verify it loaded:

```bash
copilot plugin list
# → kaizen (v1.0.0)
```

The hooks are active immediately in your next session. No configuration needed.

> **Requirements:** `sqlite3` must be on your `PATH`.
> - macOS / Linux: pre-installed.
> - Windows: `winget install SQLite.SQLite`

### Update

```bash
copilot plugin update kaizen
```

### Uninstall

```bash
copilot plugin uninstall kaizen
```

---

## Manual Install (copy files into a repo)

If you prefer to commit the hook scripts directly into a target repository:

**Bash (Linux / macOS / Windows+GitBash)**

```bash
mkdir -p .github/hooks/kaizen
cp hooks/kaizen/kaizen.sh  .github/hooks/kaizen/
cp hooks/kaizen/kaizen.ps1 .github/hooks/kaizen/
cp hooks/kaizen/hooks.json .github/hooks/kaizen.json
chmod +x .github/hooks/kaizen/kaizen.sh
```

**PowerShell (Windows / pwsh)**

```powershell
New-Item -ItemType Directory -Force -Path .github/hooks/kaizen
Copy-Item hooks\kaizen\kaizen.sh, hooks\kaizen\kaizen.ps1 -Destination .github\hooks\kaizen\
Copy-Item hooks\kaizen\hooks.json -Destination .github\hooks\kaizen.json
```

The CLI loads any `*.json` file under `.github/hooks/` — the filename `kaizen.json` is just a convention.

---

## How It Works

Kaizen registers six lifecycle events. Every handler exits in milliseconds — SQLite writes are dispatched to a background process so the agent is never blocked.

| Event | What Kaizen does |
|-------|-----------------|
| `sessionStart` | Surfaces top observations; registers the session; auto-crystallizes high-signal entries |
| `userPromptSubmitted` | Increments `prompt_count` on the session row |
| `preToolUse` | Logs tool intent — evidence of attempted calls even if the tool crashes |
| `postToolUse` | Logs tool result (`success` / `failure` / `denied`) |
| `errorOccurred` | Upserts the error as a `mistake` observation; increments `error_count` |
| `sessionEnd` | Finalises stats; promotes repeated failures to observations; runs decay/compact |

### Two-Tier Memory

| | Global `~/.copilot/kaizen.db` | Local `.kaizen/kaizen.db` |
|--|-------------------------------|---------------------------|
| **Scope** | All repos on this machine | This repo only |
| **Content** | Errors, patterns, tool insights, session metadata | Repo-specific conventions, team preferences |
| **Sharing** | Not shared | Commit to share with your team |

---

## Disable

Set `SKIP_KAIZEN=1` to disable all hooks for a session:

```bash
SKIP_KAIZEN=1 gh copilot suggest "..."
```

---

## Full Documentation

See [`hooks/kaizen/README.md`](hooks/kaizen/README.md) for:
- The full six-event loop explained
- How observations compound over time
- Adding observations manually
- Phase 2 roadmap (crystallization)
- Requirements and dependency details
