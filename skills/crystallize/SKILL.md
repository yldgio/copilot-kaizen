---
name: crystallize
description: >
  Export Kaizen procedures to .kaizen/procedures/*.md files so the team can review and commit them to git.
  Use this skill whenever the user wants to share, export, document, or commit what Kaizen has learned —
  including phrases like "export our learnings", "document what kaizen knows", "share procedures with the team",
  "wrap up the sprint", "prep for retro", "commit kaizen to git", or "what has kaizen learned?".
  Also invoke proactively before PRs, releases, or sprint reviews without waiting to be asked.
---

# Crystallize

Crystallize exports high-signal Kaizen procedures (observations that crossed `hit_count ≥ 10` and were promoted
to `kaizen_procedures`) into human-readable markdown files under `.kaizen/procedures/`, grouped by category.
The team can then review, edit, and commit these files to git so every teammate benefits at their next session start.

## Check first: is there anything to export?

If you want to confirm there are unexported procedures before running, query the DB:

```bash
sqlite3 ~/.copilot/kaizen.db "SELECT COUNT(*) FROM kaizen_procedures WHERE exported = 0;"
```

If the result is `0`, there is nothing new to export — either all procedures are already exported, or no
observations have yet crossed the `hit_count ≥ 10` threshold. Tell the user this clearly and explain that
procedures accumulate automatically as errors and patterns repeat across sessions.

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

The script is idempotent — safe to run multiple times. It only writes procedures with `exported = 0`
and marks them atomically, so a second run does nothing.

## What to expect

```
📋 Exported N procedures to .kaizen/procedures/
```

Files written per category, e.g. `.kaizen/procedures/pattern.md`, `.kaizen/procedures/mistake.md`.
Each file lists all procedures for that category as bullet points with a datestamp header.

## After exporting

1. Show the user which files were written
2. Suggest reviewing and editing them — any entry can be removed if it no longer applies
3. Commit to git: `git add .kaizen/procedures/ && git commit -m "chore: export kaizen procedures"`
4. Optionally suggest adding `.kaizen/kaizen.db` to `.gitignore` if the team prefers not to track raw DB state
