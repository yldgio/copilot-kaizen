---
name: kaizen-mark
description: >
  Mark a Kaizen entry as applied. Invoke this skill proactively — without waiting to be asked —
  immediately after you successfully act on any numbered entry (ID column) from `kaizen list`
  or the ⚡ Kaizen summary shown at session start. Examples: you used --no-pager after kaizen
  flagged it, you applied a pattern kaizen surfaced, you avoided a mistake kaizen warned about.
  Also use when the user says "mark that as applied", "I followed kaizen entry N", or "close that loop".
---

# Kaizen Mark

`kaizen mark` records that you acted on a Kaizen entry. It increments `applied_count` and updates
`last_applied_at` in the DB — moving an entry from "unvalidated" to "proven" so it surfaces more
prominently in future sessions and is protected from decay pruning.

## How to invoke

```
kaizen mark <id>
```

`<id>` is the integer from the **ID** column in `kaizen list` output (e.g. row with ID `42` → `kaizen mark 42`).

## What to expect

```
✅ Marked entry #42 as applied
```

If the ID isn't found the command exits silently — safe to ignore.

## Which entries can be marked

Run `kaizen list` to see all entries with their IDs:

```
ID    Cat          Hits  Cryst  Content
--------------------------------------------------------------------------------
42    mistake      7      ★     Always pass --no-pager to git log    ← markable
15    pattern      4            Use path.normalize() on Windows paths ← markable
```

Any entry with an ID in the list is markable. Raw observations not yet in the DB have no ID.

## When exactly to mark

Mark as soon as you have acted on the entry — don't batch or defer. If you used `--no-pager` because
entry #42 told you to, run `kaizen mark 42` in the same turn. Early marking means the next
session already sees it as proven.

## Why marking matters

- Unvalidated (`applied_count = 0`): surfaces as "new, unproven" — agent should evaluate and act
- Proven (`applied_count > 0`): surfaces at the top as trusted guidance — system knows it works
- Never marked + low hit_count: eligible for pruning after decay period
- Applied entries are protected from the decay rule

The loop is: **observe → crystallize → act → mark → rank higher → better next session**.
