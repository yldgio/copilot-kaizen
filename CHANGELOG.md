# Changelog

All notable changes to **kaizen** will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.1](https://github.com/yldgio/copilot-kaizen/compare/v1.0.0...v1.0.1) (2026-04-26)


### Bug Fixes

* set executable bit on bin scripts ([39dd69b](https://github.com/yldgio/copilot-kaizen/commit/39dd69b055bf3d995c2e64091b938dbac0438509))

## 1.0.0 (2026-04-26)


### Features

* add crystallize and kaizen-mark skills with detailed documentation ([c56667b](https://github.com/yldgio/copilot-kaizen/commit/c56667b50f2b655291dcb37522d3eec0ae943bbc))
* add Kaizen hook system (Phase 1) ([c3b8f82](https://github.com/yldgio/copilot-kaizen/commit/c3b8f82daf920b0bb8fba1e853734492072be081))
* complete Kaizen v1.2.0 migration (phases 1-9) ([3544214](https://github.com/yldgio/copilot-kaizen/commit/35442148af7ae4f3fd4602e6f8d58aaca0764789))
* package as Copilot CLI plugin ([ff20d3a](https://github.com/yldgio/copilot-kaizen/commit/ff20d3a3263656d407bccf10231a2ff817b11fd2))
* phase 1 — core infrastructure ([7a2b6e7](https://github.com/yldgio/copilot-kaizen/commit/7a2b6e709a4479904a5da607cbdd747b2c2bf6bb))
* Phase 2 - Kaizen Crystallization Loop (v1.1.0) ([3d5d013](https://github.com/yldgio/copilot-kaizen/commit/3d5d013e3bbf73cbd69bc8c31abf28f95bcd188d))
* phase 2 — hook dispatcher ([d5bd16b](https://github.com/yldgio/copilot-kaizen/commit/d5bd16bafc8a6ebf22373bbd805324a77413949e))
* Phase 2 — Kaizen Crystallization Loop (v1.1.0) ([26ed2b7](https://github.com/yldgio/copilot-kaizen/commit/26ed2b7a85d25a368aa04e619c1d43046f5371ca))
* phase 3 — inject & compress ([70cfb1c](https://github.com/yldgio/copilot-kaizen/commit/70cfb1cdb1068393930fc850190f3af9e9d52d40))
* phase 4 — synthesis ([9ffe5a3](https://github.com/yldgio/copilot-kaizen/commit/9ffe5a3e5ea89b790ae4d84ad7470d6638e2cee0))
* phase 5 — extension ([976b351](https://github.com/yldgio/copilot-kaizen/commit/976b3513695c662be27739e1c000e55852437b00))
* phase 6 — hook wrappers ([095fa08](https://github.com/yldgio/copilot-kaizen/commit/095fa08091ba6f66999f9096ef16d24fe1ce9d91))
* phase 7 — CLI and install ([573a0cc](https://github.com/yldgio/copilot-kaizen/commit/573a0cc2b859de6c3aa8bbb3d403da30e9361074))
* phase 8 — package and README ([12cc612](https://github.com/yldgio/copilot-kaizen/commit/12cc6129ef963476584c9a7e0dce11f6ed02305e))
* unified kaizen skill + install/update skills to .agents/skills/ ([7e427cc](https://github.com/yldgio/copilot-kaizen/commit/7e427cc1c85deeaa373bf3ba0e26317391750146))


### Bug Fixes

* address PR [#1](https://github.com/yldgio/copilot-kaizen/issues/1) review comments ([4ce1f91](https://github.com/yldgio/copilot-kaizen/commit/4ce1f918fce68edccf671ab9944163b3a8379596))
* update crystallize and kaizen-mark skills for v2 CLI ([99e8e64](https://github.com/yldgio/copilot-kaizen/commit/99e8e64eb6987596c6fffcf86f42cf9341c4a3cc))
* use exact string matching for memory entry lookup ([2f8fbd4](https://github.com/yldgio/copilot-kaizen/commit/2f8fbd4d00674104bfea59a5113dee6b2958eb83))

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
