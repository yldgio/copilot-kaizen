# copilot-kaizen

> Continuous-improvement memory layer for GitHub Copilot CLI

copilot-kaizen is a hook-based addon that gives Copilot CLI a **learning loop**.
It records tool usage, mistakes, and patterns during your sessions, then
synthesizes them into `.kaizen/` markdown files that are automatically injected
as context in future sessions.

The result: Copilot gets smarter about your project over time — it remembers
your conventions, your common mistakes, and your tool preferences.

---

## How it works

```
┌──────────────────────────────────────────────────────────┐
│                     Copilot CLI Session                   │
│                                                          │
│  sessionStart ──► kaizen hook ──► Insert session record   │
│                                                          │
│  preToolUse ───► kaizen hook ──► Inject .kaizen/ context │
│                        │          into additionalContext  │
│                        ▼                                 │
│                   stdout: JSON { permissionDecision,     │
│                                  additionalContext }     │
│                                                          │
│  postToolUse ──► kaizen hook ──► Log success/failure     │
│                                                          │
│  errorOccurred ► kaizen hook ──► Record mistake entry    │
│                                                          │
│  sessionEnd ───► kaizen hook ──► Synthesize learnings    │
│                        │          into .kaizen/*.md      │
│                        ▼                                 │
│                   Update auto-blocks, rebuild index,     │
│                   decay old entries                       │
└──────────────────────────────────────────────────────────┘
```

---

## Install

### Step 1: Install globally

```bash
npm install -g copilot-kaizen
```

Or with your preferred package manager:

```bash
pnpm add -g copilot-kaizen
yarn global add copilot-kaizen
bun install -g copilot-kaizen
```

> ⚠️ **npx is NOT supported at runtime.** The `preToolUse` hook has a 2-second
> timeout and `npx` cold-start takes longer. You must install globally so the
> `kaizen` binary is on your PATH.

### Step 2: Set up a project

```bash
cd your-project
kaizen install
```

This creates:

| Path | Purpose |
|------|---------|
| `.kaizen/kaizen.md` | Memory index (auto-updated) |
| `.kaizen/general.md` | General conventions (human-editable) |
| `.kaizen/tools/` | Per-tool guidance files |
| `.kaizen/domain/` | Domain knowledge files |
| `.github/hooks/kaizen.json` | Hook configuration for Copilot CLI |
| `.github/hooks/kaizen/` | Hook wrapper scripts (gitignored) |
| `.github/extensions/kaizen/` | Copilot CLI extension (gitignored) |

### Step 3: Commit `.kaizen/` to your repo

```bash
git add .kaizen/
git commit -m "chore: add kaizen memory directory"
```

The hook wrappers and extension are auto-gitignored — only `.kaizen/` needs to
be committed. Team members who also install `copilot-kaizen` globally will
automatically get your project's kaizen context.

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `kaizen install [dir]` | Set up kaizen in a project directory |
| `kaizen add <category> <text>` | Manually add a kaizen entry |
| `kaizen list [category]` | List entries for this project |
| `kaizen mark <id>` | Mark an entry as applied |
| `kaizen sync` | Force synthesis + index rebuild |
| `kaizen reorganize` | Rebuild the kaizen.md index |

### Categories

| Category | Use for |
|----------|---------|
| `mistake` | Errors and bugs the AI encountered |
| `pattern` | Recurring patterns (good or bad) |
| `memory` | Things the AI should remember |
| `convention` | Project conventions and rules |

### Examples

```bash
# Add a convention
kaizen add convention "Always use pino for logging, never console.log"

# Add a mistake you want the AI to learn from
kaizen add mistake "Forgot to check null before accessing .length"

# List all patterns
kaizen list pattern

# Mark an entry as applied (entry ID from `kaizen list`)
kaizen mark 42

# Force a synthesis run (normally happens at session end)
kaizen sync
```

---

## File Structure

### `.kaizen/` directory (committed to repo)

```
.kaizen/
├── kaizen.md      ← Auto-generated index of all memory files
├── general.md     ← General conventions (human + auto blocks)
├── tools/
│   ├── edit.md    ← Guidance for the `edit` tool
│   ├── bash.md    ← Guidance for the `bash` tool
│   └── ...
└── domain/
    ├── auth.md    ← Domain knowledge about auth
    └── ...
```

### Human vs Auto content

Each `.md` file can contain both human-authored and auto-generated content.
The auto-generated content is enclosed in markers:

```markdown
# General

Use pino for logging. (← human-authored, never touched)

Always validate inputs. (← human-authored)

<!-- kaizen:auto -->
## Auto-generated (last synthesis)

- [2025-04-20] Forgot null check in auth handler  (seen 5x)
- [2025-04-19] Used wrong import path  (seen 3x)
<!-- /kaizen:auto -->
```

**kaizen never modifies content outside the auto-block markers.** Your
hand-written conventions are always safe.

---

## Database

kaizen stores session data and entries in a SQLite database at:

```
~/.copilot/kaizen/kaizen.db
```

This is a user-global database with a `project_path` column for per-project
isolation. All projects share one DB file.

### Tables

| Table | Purpose |
|-------|---------|
| `kaizen_sessions` | Session lifecycle tracking |
| `kaizen_tool_log` | Tool usage events (pre/post:success/post:failure) |
| `kaizen_entries` | Kaizen memory entries (mistakes, patterns, etc.) |

---

## How hooks work

When Copilot CLI fires a hook event:

1. Copilot CLI reads `.github/hooks/kaizen.json`
2. Runs the appropriate wrapper script (`.github/hooks/kaizen/kaizen.sh` or `.ps1`)
3. The wrapper script pipes stdin to `kaizen hook <event>`
4. `kaizen hook` dispatches to the correct handler in `kaizen.mjs`
5. For `preToolUse`: returns JSON to stdout with `permissionDecision` and optional `additionalContext`
6. For all other events: no stdout, side effects only (DB writes, synthesis)

### Timeouts

| Event | Timeout | Why |
|-------|---------|-----|
| `preToolUse` | 2s | On the critical path — must be fast |
| `postToolUse` | 5s | Simple DB insert |
| `errorOccurred` | 5s | Simple DB insert |
| `sessionStart` | 10s | DB insert + tmp file write |
| `sessionEnd` | 30s | Synthesis + decay + cleanup |

### Safety guarantees

- **Crash-to-success:** If kaizen crashes, it exits with code 0. Copilot CLI
  is never blocked.
- **Kill-switch:** Set `SKIP_KAIZEN=1` in your environment to disable all hooks.
- **No stdout pollution:** Only `preToolUse` produces stdout (valid JSON).
  All other hooks are silent.

---

## Architecture

```
copilot-kaizen/
├── package.json              Package manifest
├── hooks.json                Template for .github/hooks/kaizen.json
├── kaizen.mjs                Hook dispatcher (core engine)
├── extension.mjs             Copilot CLI extension (onSessionStart)
├── lib/
│   ├── db.mjs                SQLite database layer (better-sqlite3)
│   ├── inject.mjs            Context assembly for hook injection
│   ├── synthesize.mjs        Session-end synthesis engine
│   ├── compress.mjs          Text compression for context budgets
│   └── project.mjs           Project path utilities
├── bin/
│   ├── kaizen.mjs            CLI entry point
│   └── install.mjs           Project installer
├── hooks/
│   ├── kaizen.sh             Unix hook wrapper (static)
│   └── kaizen.ps1            Windows hook wrapper (static)
└── templates/
    ├── kaizen.md.tmpl        Template for .kaizen/kaizen.md
    └── general.md.tmpl       Template for .kaizen/general.md
```

### Dependencies

- **Runtime:** `better-sqlite3` (single native dependency)
- **Node.js:** >=18 (ESM modules)
- **No other runtime deps.** No frameworks, no HTTP servers, no transpilers.

---

## Troubleshooting

### "kaizen: command not found"

The `kaizen` binary is not on your PATH. Re-install globally:

```bash
npm install -g copilot-kaizen
```

Verify:

```bash
which kaizen    # Unix
where kaizen    # Windows
```

### Hooks not firing

1. Check `.github/hooks/kaizen.json` exists and is valid JSON
2. Check `.github/hooks/kaizen/kaizen.sh` exists and is executable
3. Run `kaizen hook sessionStart <<< '{"cwd":"."}'` manually to test

### Disable kaizen temporarily

```bash
export SKIP_KAIZEN=1
# or on Windows:
$env:SKIP_KAIZEN = "1"
```

### Reset the database

```bash
rm ~/.copilot/kaizen/kaizen.db
kaizen install .    # re-creates the DB
```

### View raw database

```bash
sqlite3 ~/.copilot/kaizen/kaizen.db "SELECT * FROM kaizen_entries ORDER BY hit_count DESC LIMIT 20"
```

---

## License

MIT
