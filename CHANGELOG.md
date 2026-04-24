# Changelog

All notable changes to **kaizen** will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
