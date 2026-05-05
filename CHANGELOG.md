# Changelog

All notable changes to **kaizen** will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0](https://github.com/yldgio/copilot-kaizen/compare/v1.1.0...v2.0.0) (2026-05-05)


### ⚠ BREAKING CHANGES

* new 'preference' category added to kaizen entries
* Removes hooks.json, kaizen.mjs, and hooks/ directory. The extension now uses joinSession() from @github/copilot-sdk/extension with a trampoline at ~/.copilot/extensions/kaizen/extension.mjs.

### Features

* add kaizen_remember and kaizen_search SDK tools ([b74525d](https://github.com/yldgio/copilot-kaizen/commit/b74525d8439c9cd7606753f5d03691dbd74d2eb7))
* inject all .kaizen/*.md files at session start ([f16972d](https://github.com/yldgio/copilot-kaizen/commit/f16972d75e5d294d24c8bdda83be2ee6d44703f9))
* migrate from command hooks to SDK extension architecture ([d9fefc8](https://github.com/yldgio/copilot-kaizen/commit/d9fefc83aae79a68eceeb32f7269cc12c87eb640))
* replace better-sqlite3 with sql.js (pure WASM) ([1cdc67c](https://github.com/yldgio/copilot-kaizen/commit/1cdc67c9e7fea21d271d81bad4ded4c034f1ab01))


### Bug Fixes

* 4 bugs from adversarial code review ([8ffc267](https://github.com/yldgio/copilot-kaizen/commit/8ffc267aed4cf57024578dce304512b052eb7022))
* **extension:** lazy-init projectPath in onPreToolUse after hot-reload ([5bff49d](https://github.com/yldgio/copilot-kaizen/commit/5bff49d879adc84c987daacfd49b267c5860169c))
* improve error handling in onPreToolUse logging ([fa304e2](https://github.com/yldgio/copilot-kaizen/commit/fa304e20e73c16753a05a6fe3c563b5f010ec202))
* migrate remaining better-sqlite3 API calls to sql.js ([d790e50](https://github.com/yldgio/copilot-kaizen/commit/d790e507066bc544d41d0e5560de7e01976dae12))
* missing closing brace in onErrorOccurred + docs update ([1079dde](https://github.com/yldgio/copilot-kaizen/commit/1079ddea6c973a34e84d88f1e46923d7ea54bab4))
* write per-category synthesis files instead of filtered general.md ([0de540b](https://github.com/yldgio/copilot-kaizen/commit/0de540beb82926f9ee69f62029e97f4102ffa9a2))

## [1.1.0](https://github.com/yldgio/copilot-kaizen/compare/v1.0.1...v1.1.0) (2026-04-27)


### Features

* add devcontainer setup and plugin installation scripts ([0a4fca4](https://github.com/yldgio/copilot-kaizen/commit/0a4fca4f0f9659d6b1d4f4f267ad9ebd1796c292))
* add MCP server configuration for context7 and Microsoft Docs ([d5a9c1a](https://github.com/yldgio/copilot-kaizen/commit/d5a9c1afd5c242197164abd4e91bd6682f14e7e1))
* add one-liner bash and PowerShell installers ([7200649](https://github.com/yldgio/copilot-kaizen/commit/7200649325459f00a8ea3587fbeec01708c1c0ed))


### Bug Fixes

* add skills/ to package.json files array ([8b734ef](https://github.com/yldgio/copilot-kaizen/commit/8b734ef0da28348fc723363d1a166a06946018bc))
* address tenth-man audit findings ([a160acb](https://github.com/yldgio/copilot-kaizen/commit/a160acbb389c86168c6bd814141cfa52627da392))
* **hooks:** use documented Copilot CLI hook schema; auto-rewrite legacy configs ([c04fad6](https://github.com/yldgio/copilot-kaizen/commit/c04fad6ecb6638dc83599cbbacdfdbe572ad9de5))

## [1.0.2](https://github.com/yldgio/copilot-kaizen/compare/v1.0.1...v1.0.2) (2026-04-27)


### Bug Fixes

* **hooks:** ship `hooks.json` in the documented Copilot CLI schema (`type: command` + `bash` / `powershell` strings). The previous schema (`command` + `args` + `commandWindows` + `argsWindows`) was undocumented and silently never fired — hooks installed on existing setups did not run. ([c04fad6](https://github.com/yldgio/copilot-kaizen/commit/c04fad6))
* **install:** auto-detect and rewrite legacy `kaizen.json` configs on `kaizen install` / `kaizen update`; original is preserved as `.bak-<timestamp>`. ([c04fad6](https://github.com/yldgio/copilot-kaizen/commit/c04fad6))
* **wrappers:** honor `SKIP_KAIZEN=1` kill-switch in both `kaizen.sh` and `kaizen.ps1`. ([a160acb](https://github.com/yldgio/copilot-kaizen/commit/a160acb))
* **install.sh:** strip UTF-8 BOM that caused `exec format error` on some POSIX shells. ([a160acb](https://github.com/yldgio/copilot-kaizen/commit/a160acb))
* **ci:** bump `release-please-action` to v5 and tolerate the upstream GraphQL "Fetching merge commits" outage (see googleapis/release-please#2577).

### ⚠️ Upgrade note

Existing installs MUST run `kaizen update` to rewrite `.github/hooks/kaizen.json`. Without this, hooks remain silently disabled. The legacy file is backed up as `kaizen.json.bak-<timestamp>`.

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
