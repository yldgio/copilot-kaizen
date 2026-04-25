---
name: kaizen-mark
description: >
  Mark a Kaizen crystallized entry as applied. Invoke this skill proactively — without waiting to be asked —
  immediately after you successfully act on any numbered entry (📋 [N]) from the ⚡ Kaizen summary
  shown at session start. Examples: you used --no-pager after kaizen flagged it, you applied a pattern
  kaizen surfaced, you avoided a mistake kaizen warned about. Usage: kaizen-mark --applied <id>
  Also use when the user says "mark that as applied", "I followed kaizen entry N", or "close that loop".
---

# Kaizen Mark

`kaizen-mark` records that you acted on a Kaizen crystallized entry. It increments `applied_count` and updates
`last_applied_at` on `kaizen_entries` — moving an entry from "unvalidated" to "proven" so it surfaces more
prominently in future sessions and is protected from decay pruning.

## How to invoke

**Bash / macOS / Linux / WSL:**
```bash
bash skills/kaizen-mark/kaizen-mark.sh --applied <id>
```

**PowerShell / Windows:**
```powershell
pwsh skills/kaizen-mark/kaizen-mark.ps1 --applied <id>
```

`<id>` is the integer in brackets from the session-start summary (e.g. `📋 [3]` → `--applied 3`).

## What to expect

```
✅ Marked entry #3 as applied
```

Silent exit means the ID wasn't found or not crystallized. Safe to ignore.

## Which entries can be marked

The session-start summary has two kinds of entries — only numbered ones have a DB id:

```
📋 [3] mistake: Always pass --no-pager to git    ← crystallized entry, markable
• tool_insight: bash failed 4 times              ← raw observation, not yet markable
```

Mark `📋 [N]` entries. Bullet-point (`•`) entries have no id yet.

## When exactly to mark

Mark as soon as you have acted on the entry — don't batch or defer. If you used `--no-pager` because
entry #3 told you to, run `kaizen-mark --applied 3` in the same turn. Early marking means the next
session already sees it as proven.

## Why marking matters

- Unvalidated (`applied_count = 0`): surfaces as "new, unproven" — agent should evaluate and act
- Proven (`applied_count > 0`): surfaces at the top as trusted guidance — system knows it works
- Never marked + not crystallized: pruned after 60 days with low hit_count
- Applied entries are protected from the decay rule

The loop is: **observe → crystallize → act → mark → rank higher → better next session**.
