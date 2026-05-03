# Extension-only architecture, drop command hooks

The hooks.json command-hook architecture silently ignores `additionalContext` in preToolUse responses — only `permissionDecision` and `permissionDecisionReason` are read by the CLI. This means kaizen's core feature (context injection) does not work via command hooks. We migrate to a single SDK extension using `joinSession()` from `@github/copilot-sdk/extension`, which supports `additionalContext` in hook responses natively. hooks.json, the shell wrappers, and the kaizen.mjs dispatcher are all removed.

## Considered options

- **Keep hooks.json + patch extension.mjs** — Would still not fix `additionalContext` in preToolUse; the limitation is in the CLI's command-hook protocol, not in our code.
- **Hybrid (hooks.json for permissions, extension for injection)** — Adds complexity for no benefit; the extension API is a strict superset of command hooks.

## Consequences

- The extension is user-scoped (`~/.copilot/extensions/kaizen/`), fires for all repos. Per-project opt-in is controlled by the presence of `.kaizen/`.
- `session.shutdown` (event) replaces `sessionEnd` (hook) and provides richer data (token counts, model metrics, code changes).
- The skill file (`skills/kaizen/SKILL.md`) is unaffected — it was never part of the hook pipeline.
