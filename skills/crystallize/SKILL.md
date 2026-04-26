---
name: crystallize
description: >
  Review, synthesize, and commit what Kaizen has learned across sessions.
  Use this skill whenever the user wants to see what kaizen has learned, export learnings,
  review kaizen memory, wrap up the sprint, prep for retro, commit kaizen, find out what patterns
  have been captured, or reorganize memory.
  Also invoke proactively before PRs, releases, or sprint reviews without waiting to be asked.
---

# Crystallize

Crystallize surfaces Kaizen's accumulated knowledge — listing all captured entries and optionally
forcing a synthesis pass that regenerates the `.kaizen/` markdown files from the DB.

## How to invoke

**Step 1 — List current entries:**
```
kaizen list
```

This shows all entries scoped to the current project with their ID, category, hit count, and
crystallization status (★ = promoted to long-term memory).

**Step 2 (optional) — Force synthesis + rebuild `.kaizen/` markdown files:**
```
kaizen sync
```

`kaizen sync` reads the top entries from the DB, updates the auto-blocks inside `.kaizen/*.md`,
and rebuilds `.kaizen/kaizen.md`. Run this when the markdown files feel stale or before committing.

## What to expect from `kaizen list`

```
ID    Cat          Hits  Cryst  Content
--------------------------------------------------------------------------------
42    mistake      7      ★     Always pass --no-pager to git log
15    pattern      4            Use path.normalize() on Windows paths
 8    convention   2            Prefer kebab-case for skill folder names
```

- **★ (crystallized)**: entry has crossed the hit threshold and is promoted to long-term memory
- **Hits**: how many times the hook has seen this pattern recur
- **ID**: integer used with `kaizen mark` to record that you acted on the entry

## After listing / syncing

1. Show the user the `kaizen list` output
2. If `.kaizen/` files were updated by `kaizen sync`, suggest reviewing them:
   ```
   kaizen sync
   # then review .kaizen/kaizen.md
   ```
3. Commit any updated files to git:
   ```
   git add .kaizen/ && git commit -m "chore: update kaizen memory files"
   ```

Any entry can be removed or edited directly in the `.kaizen/*.md` files if it no longer applies.
