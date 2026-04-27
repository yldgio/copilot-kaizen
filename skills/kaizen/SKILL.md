---
name: kaizen
description: >
  Use kaizen CLI to review what the project learned, mark entries as applied, add new entries, or sync the memory index.
  Invoke this skill automatically — without being asked — whenever ANY of these
  signals appear: the user corrects a mistake you just made ("no", "wrong", "not
  like that", "undo", "you missed", "that's not right"); the user redirects you
  after you went down the wrong path; you realize mid-task you made a significant
  error and had to backtrack; the user has to re-explain something you already
  got wrong once. Invoke it as part of the same response where you acknowledge the correction
  when the user says mentions: "kaizen", "learnings", "list patterns", "list mistakes", or any mention of kaizen memory/entries.
  Also invoke proactively — without being asked — immediately after you act on a numbered
  entry from the session-start kaizen summary. This skill is compulsory — every learning must be captured.
  Do not skip it because the fix is already done. Do not wait to be asked.
---

# Kaizen

The kaizen CLI is your interface to the project's continuous-improvement memory.
It reads from and writes to `~/.copilot/kaizen/kaizen.db` scoped to the current project.

## Commands

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
- **Cat** — category (`mistake`, `pattern`, `memory`, `convention`)
- **Hits** — how many times the hook has seen this pattern recur
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

Manually add a new kaizen entry. Valid categories: `mistake`, `pattern`, `memory`, `convention`.

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
