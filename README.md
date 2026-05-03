# copilot-kaizen

> Continuous-improvement memory layer for GitHub Copilot CLI

copilot-kaizen is a Copilot CLI **extension** that gives your sessions a **learning loop**.
It records tool usage, mistakes, and patterns during sessions, then synthesizes
them into `.kaizen/` markdown files that are automatically injected as context
in future sessions via `additionalContext`.

The result: Copilot gets smarter about your project over time — it remembers
your conventions, your common mistakes, and your tool preferences.

---

## How it works

```
┌──────────────────────────────────────────────────────────┐
│                   Copilot CLI Session                     │
│                                                          │
│  onSessionStart ──► Inject .kaizen/ context (broad)     │
│                     Insert session record                │
│                                                          │
│  onPreToolUse ───► Inject .kaizen/tools/<tool>.md       │
│                    (deduped: once per tool per session)  │
│                    Log tool invocation                   │
│                                                          │
│  onPostToolUse ──► Log success/failure                  │
│                                                          │
│  onErrorOccurred ► Record mistake entry                 │
│                                                          │
│  session.shutdown ► Synthesize learnings into .kaizen/  │
│                     Decay old entries, update stats      │
└──────────────────────────────────────────────────────────┘
```

---

## Quick Install

```bash
# Clone and install globally
git clone https://github.com/yldgio/copilot-kaizen.git
cd copilot-kaizen && npm install && npm link

# Set up in your project
cd your-project
kaizen install .
```

> **Prerequisites:** Node.js 18+ and npm.

---

## Install

### Step 1: Install globally

```bash
npm install -g @yldgio/copilot-kaizen
```

### Step 2: Set up a project

```bash
cd your-project
kaizen install .
```

This creates:

| Path | Purpose |
|------|---------|
| `.kaizen/kaizen.md` | Memory index (auto-updated) |
| `.kaizen/general.md` | General conventions (human-editable) |
| `.kaizen/tools/` | Per-tool guidance files |
| `.kaizen/domain/` | Domain knowledge files |
| `~/.copilot/extensions/kaizen/` | Extension trampoline (auto-managed) |
| `.agents/skills/kaizen/` | Copilot CLI skill |

### Step 3: Commit `.kaizen/` and `.agents/skills/kaizen/`

```bash
git add .kaizen/ .agents/skills/kaizen/
git commit -m "chore: add kaizen memory directory and skill"
```

The extension trampoline lives in your home directory — nothing project-local
needs to be gitignored.

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `kaizen install [dir]` | Set up kaizen in a project directory |
| `kaizen update [dir]` | Force-update trampoline and skills |
| `kaizen uninstall` | Remove the extension (preserves .kaizen/ and DB) |
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
kaizen add convention "Always use pino for logging, never console.log"
kaizen add mistake "Forgot to check null before accessing .length"
kaizen list pattern
kaizen mark 42
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
Auto-generated content is enclosed in markers:

```markdown
# General

Use pino for logging.

<!-- kaizen:auto -->
## Auto-generated (last synthesis)

- [2025-04-20] Forgot null check in auth handler  (seen 5x)
- [2025-04-19] Used wrong import path  (seen 3x)
<!-- /kaizen:auto -->
```

**kaizen never modifies content outside the auto-block markers.**

---

## Architecture

```
copilot-kaizen/
├── package.json              Package manifest
├── extension.mjs             SDK extension (joinSession + hooks)
├── lib/
│   ├── db.mjs                SQLite database layer (better-sqlite3)
│   ├── inject.mjs            Context assembly for injection
│   ├── synthesize.mjs        Session-end synthesis engine
│   ├── compress.mjs          Text compression for context budgets
│   └── project.mjs           Project path utilities
├── bin/
│   ├── kaizen.mjs            CLI entry point
│   └── install.mjs           Installer (writes trampoline)
├── templates/
│   ├── kaizen.md.tmpl        Template for .kaizen/kaizen.md
│   └── general.md.tmpl       Template for .kaizen/general.md
├── skills/kaizen/            Copilot skill definition
├── test/                     Test suite
└── docs/adr/                 Architectural Decision Records
```

### Extension loading

The installer writes a **trampoline** at `~/.copilot/extensions/kaizen/extension.mjs`:

```js
await import("/absolute/path/to/copilot-kaizen/extension.mjs");
```

This ensures `better-sqlite3` (a native dependency) resolves from the package's
own `node_modules/`, not from the CLI's extension sandbox.

### Dependencies

- **Runtime:** `better-sqlite3` (single native dependency)
- **Node.js:** >=18 (ESM modules)
- **No other runtime deps.**

---

## Database

kaizen stores session data and entries in a SQLite database at:

```
~/.copilot/kaizen/kaizen.db
```

User-global, with `project_path` column for per-project isolation.

### Tables

| Table | Purpose |
|-------|---------|
| `kaizen_sessions` | Session lifecycle tracking |
| `kaizen_tool_log` | Tool usage events (pre/post:success/post:failure) |
| `kaizen_entries` | Kaizen memory entries (mistakes, patterns, etc.) |

---

## Troubleshooting

### Extension not loading

1. Check trampoline exists: `cat ~/.copilot/extensions/kaizen/extension.mjs`
2. Verify it points to the correct path
3. Re-run `kaizen install .` to regenerate

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

### Uninstall

```bash
kaizen uninstall     # removes extension trampoline
# Optionally: rm -rf ~/.copilot/kaizen/  (removes DB)
```

---

## License

MIT
