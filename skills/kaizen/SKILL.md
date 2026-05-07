---
name: kaizen
description: >
  Use kaizen tools and CLI to manage the project's continuous-improvement memory.
  **Prefer native tools** (`kaizen_remember`, `kaizen_search`) over CLI when available.
  Auto-invoke this skill — without being asked — when: the user corrects a mistake
  you made ("no", "wrong", "not like that", "undo", "you missed", "that's not right");
  the user redirects you after a wrong path; you realize a significant error and
  backtrack; or the user must re-explain something you already got wrong once.
  Invoke it in the same response where you acknowledge the correction. Also invoke
  it when the user mentions "kaizen", "learnings", "list patterns", "list mistakes",
  or kaizen memory/entries. Also invoke proactively right after acting on a numbered
  entry from the session-start kaizen summary. This skill is compulsory: capture
  every learning. Do not skip because the fix is already done. Do not wait to be asked.
---

# Kaizen

The kaizen extension provides both **native SDK tools** and a **CLI** for managing the project's continuous-improvement memory.
It reads from and writes to `~/.copilot/kaizen/kaizen.db` scoped to the current project.

## Native Tools (preferred)

### `kaizen_remember`

Save a learning directly — no bash needed. The agent calls this tool when it detects something worth remembering.

**Parameters:**
- `category` — one of: `mistake`, `pattern`, `convention`, `memory`, `preference`
- `content` — the learning text (specific and actionable)

**When to use each category:**
- `mistake` — the user corrected an error you made
- `convention` — a project rule ("always use pino", "never touch that file")
- `pattern` — a recurring approach discovered during work
- `memory` — a specific project fact ("DB schema is in tools/db/schema.ts")
- `preference` — a user/team preference ("respond in Italian", "use conventional commits")

Returns confirmation with hit count and similar existing entries for dedup awareness.

### `kaizen_search`

Search existing learnings before saving (to avoid duplicates) or to recall conventions.

**Parameters:**
- `query` — keyword to search for (required)
- `category` — optional filter
- `limit` — max results (default 10)

## CLI Commands (fallback — use when native tools aren't available)

### `kaizen list [category]`

List all kaizen entries for this project.

```
kaizen list
kaizen list mistake
kaizen list pattern
```

Output columns:

```
ID    Cat          Hits  Cryst  Content
--------------------------------------------------------------------------------
42    mistake      7      ★     Always pass --no-pager to git log
15    pattern      4            Use path.normalize() on Windows paths
 8    convention   2            Prefer kebab-case for skill folder names
```

- **ID** — integer used with `kaizen mark` to record that you acted on an entry
- **Cat** — category (`mistake`, `pattern`, `memory`, `convention`, `preference`)
- **Hits** — how many times this pattern has been independently observed
- **Cryst (★)** — crystallized: entry crossed the hit threshold and is in long-term memory
- **Content** — the captured text (truncated at 50 chars)

### `kaizen mark <id>`

Mark an entry as applied. `<id>` comes from the **ID** column in `kaizen list` output.

```
kaizen mark 42
```

Expected output:

```
✓ Marked entry 42 as applied.
```

### `kaizen add <category> <text>`

Manually add a new kaizen entry. Valid categories: `mistake`, `pattern`, `memory`, `convention`, `preference`.

```
kaizen add convention "Always use pino for logging, never console.log"
kaizen add mistake "Forgot to handle null before accessing .length"
kaizen add pattern "Use path.normalize() on Windows paths"
kaizen add memory "The DB schema is in tools/db/schema.ts"
```

### `kaizen sync`

Force synthesis + rebuild `.kaizen/*.md` files from the DB. Run this when the markdown
files feel stale or before committing.

```
kaizen sync
```

Reads top entries from DB, updates auto-blocks inside `.kaizen/*.md`, and rebuilds
`.kaizen/kaizen.md`.

### `kaizen reorganize`

Rebuild the `.kaizen/kaizen.md` index file only (faster than `kaizen sync`).

```
kaizen reorganize
```

---

## When to mark proactively

**Mark immediately after acting on an entry — don't defer.**

If entry #42 says "Always pass `--no-pager` to git log" and you just used `--no-pager`,
run `kaizen mark 42` in that same turn.

Early marking:
- Moves the entry from "unproven" → "proven"
- Protects it from decay pruning
- Surfaces it more prominently in future sessions

The loop is: **observe → crystallize → act → mark → rank higher → better next session**.

Entries not marked + low `hit_count` are eligible for pruning after the decay period.

---

## After listing entries

1. Show the `kaizen list` output to the user
2. If files feel stale, run `kaizen sync` and review `.kaizen/kaizen.md`
3. Commit updated `.kaizen/` files:
   ```
   git add .kaizen/ && git commit -m "chore: update kaizen memory"
   ```
