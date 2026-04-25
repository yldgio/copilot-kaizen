---
name: crystallize
description: >
  Reorganize Kaizen memory files and display the merged knowledge index.
  Use this skill whenever the user wants to share, export, document, or commit what Kaizen has learned —
  including phrases like "export our learnings", "document what kaizen knows", "share procedures with the team",
  "wrap up the sprint", "prep for retro", "commit kaizen to git", "what has kaizen learned?", or "reorganize memory".
  Also invoke proactively before PRs, releases, or sprint reviews without waiting to be asked.
---

# Crystallize

Crystallize reorganizes Kaizen's file-based memory (deduplicates entries, sorts by date, rebuilds the
`kaizen.md` index) and prints the merged knowledge index so the team can review and commit it.

Memory files live under:
- **Global**: `~/.copilot/kaizen/` — cross-project knowledge
- **Local**: `.kaizen/` in the project root — project-specific knowledge (committable)

## Check first: is there any memory?

Check if memory files exist:

```bash
ls ~/.copilot/kaizen/kaizen.md .kaizen/kaizen.md 2>/dev/null
```

If neither file exists, there is nothing to reorganize — no observations have yet crossed the `hit_count ≥ 10`
crystallization threshold. Tell the user this clearly and explain that memory accumulates automatically as
errors and patterns repeat across sessions.

## How to invoke

Pick the script that matches the current shell:

**Bash / macOS / Linux / WSL:**
```bash
bash skills/crystallize/crystallize.sh
```

**PowerShell / Windows (pwsh or powershell.exe):**
```powershell
pwsh skills/crystallize/crystallize.ps1
```

The script is idempotent — safe to run multiple times. It deduplicates entries and rebuilds the index.

## What to expect

```
⚡ Kaizen reorganize complete
  • general.md: 5 entries (removed 2 duplicates)
  • tools/bash.md: 3 entries
  • kaizen.md: index updated (2 files)

📚 Merged Kaizen Memory Index:

— Global —
# Kaizen Memory Index
- general.md — cross-project conventions and recorded mistakes (5 entries)
- tools/bash.md — bash tool insights (3 entries)

— Local —
# Kaizen Memory Index
- domain/copilot-kaizen.md — copilot-kaizen knowledge (2 entries)

📋 Memory reorganized. Review .kaizen/ and git add .kaizen/*.md
```

## After reorganizing

1. Show the user the merged index
2. Suggest reviewing and editing the `.kaizen/*.md` files — any entry can be removed if it no longer applies
3. Commit to git: `git add .kaizen/ && git commit -m "chore: update kaizen memory files"`

## Deprecated: .kaizen/procedures/

The old `.kaizen/procedures/` output path is no longer used. Existing files there are NOT deleted
automatically — developers may keep them for reference or remove them manually.
