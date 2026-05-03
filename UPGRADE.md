# Upgrading to v2.0.0

## ⚠ BREAKING CHANGES

- **Architecture**: Migrated from command hooks (`hooks.json` + shell wrappers) to SDK extension (`joinSession()` from `@github/copilot-sdk/extension`). See [ADR-0001](docs/adr/0001-extension-only-drop-hooks.md).
- **Removed**: `hooks.json`, `hooks/kaizen.sh`, `hooks/kaizen.ps1`, `kaizen.mjs` (old hook dispatcher)
- **Removed**: `kaizen hook` CLI command and stdin-based hook protocol
- **Install**: `kaizen install` no longer copies hooks — writes a trampoline extension to `~/.copilot/extensions/kaizen/`

## What's new

- SDK extension with 5 hook handlers: `onSessionStart`, `onPreToolUse`, `onPostToolUse`, `onErrorOccurred`, `onShutdown`
- Session-level context injection via `additionalContext` (now actually works — command hooks silently ignored it)
- Per-tool context injection from `.kaizen/tools/<tool>.md` (deduplicated per session)
- Global fallback: injects `~/.copilot/kaizen/kaizen.md` when no `.kaizen/` directory exists
- `kaizen uninstall` CLI command to remove extension trampoline
- Trampoline uses `file:///` URL scheme for Windows ESM compatibility ([ADR-0002](docs/adr/0002-trampoline-for-native-deps.md))
- 22 tests covering all hook handlers and installer

## Bugs fixed

- Context injection now works (command hooks never supported `additionalContext` in `preToolUse`)
- Trampoline uses `pathToFileURL()` — bare paths fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME` on Windows
- `onShutdown` preserves `error_count` accumulated by `onErrorOccurred` (was overwritten with 0)
- DB handle closed before re-opening on duplicate `onSessionStart`

## How to upgrade

```bash
kaizen install .    # Regenerates trampoline, removes legacy hooks
```

This is safe to run on existing installations. It will:
1. Recreate the `.kaizen/` directory (skips existing files)
2. Write the new extension trampoline to `~/.copilot/extensions/kaizen/`
3. Remove legacy artifacts: `.github/hooks/kaizen`, `.github/hooks/kaizen.json`, `.github/extensions/kaizen`

Your `.kaizen/*.md` content and database (`~/.copilot/kaizen/kaizen.db`) are preserved.
