# Changelog

All notable changes to **kaizen** will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] — 2026-04-25

### Added
- Hierarchical file-based memory: `~/.copilot/kaizen/` (global) + `.kaizen/` (project-local)
- Memory file routing: `tool_insight` → `tools/{name}.md`, `mistake` → `general.md`, else → `domain/{topic}.md`
- `kaizen.md` index file: auto-generated table of contents for memory files
- `preToolUse` injects per-tool memory files once per session
- `reorganize` event: dedup, merge, sort, and reindex memory files
- `applied_count` and `last_applied_at` columns on `kaizen_entries`
- `crystallized_at` column on `kaizen_entries`
- One-time migration from `kaizen_procedures` to memory files
- Backfill of `applied_count` from `kaizen_procedures` to `kaizen_entries`

### Changed
- `sessionStart` now outputs merged `kaizen.md` index (global + local) with fallback to raw observations
- `sessionStart` numbered entries now source from `kaizen_entries` instead of `kaizen_procedures`
- `sessionEnd` crystallizes newly-eligible entries to memory files
- `sessionEnd` decay rule now checks `applied_count` on `kaizen_entries`
- `crystallize` skill repurposed as memory reorganizer (calls `reorganize`, prints index)
- `kaizen-mark` skill retargeted to `kaizen_entries` instead of `kaizen_procedures`
- `.gitignore` updated: `.kaizen/` → `.kaizen/*.db` (allows committing `.kaizen/*.md`)

### Deprecated
- `kaizen_procedures` table retained but inert — no new rows inserted
- `.kaizen/procedures/` output path no longer written

---

## [1.1.0] — 2026-04-25

### Added
- Phase 2: Crystallized procedures surfaced at session start (3 unvalidated + 2 proven, hybrid ranking)
- Phase 2: `crystallize` skill — exports procedures to `.kaizen/procedures/<category>.md` for team sharing
- Phase 2: `kaizen-mark` skill — mark procedures as applied (`kaizen-mark --applied <id>`)
- Phase 2: `last_applied_at` column on `kaizen_procedures` (idempotent migration)
- Phase 2: Procedure decay at session end (90 days if never applied, 60 days since last application)

### Changed
- `sessionStart` output now shows both procedures (📋) and observations (•) with procedure IDs visible
- `sessionEnd` decay block now includes procedure pruning rules

---

## [1.0.0] — 2026-04-24

### Added
- Six-event lifecycle hook (`sessionStart`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`, `sessionEnd`)
- Dual-script implementation: `kaizen.sh` (Bash) and `kaizen.ps1` (PowerShell)
- Two-tier SQLite memory: global `~/.copilot/kaizen.db` + optional local `.kaizen/kaizen.db`
- Auto-crystallization of high-signal entries (`hit_count ≥ 10`) into `kaizen_procedures`
- Background write dispatch (non-blocking — sub-millisecond hook exit)
- Decay/compact cleanup on clean `sessionEnd` (prune tool logs > 7 days, low-signal entries > 60 days)
- `SKIP_KAIZEN=1` kill-switch for both scripts
- Copilot CLI plugin packaging (`plugin.json` + root `hooks.json`)
- JSON parsing fallback chain in Bash: `jq` → `python3`/`python` → `sed`
- Per-project session ID keyed on working directory (supports concurrent sessions)
