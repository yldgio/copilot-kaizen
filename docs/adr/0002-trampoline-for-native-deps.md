# Trampoline pattern for native dependencies

Copilot CLI loads extensions from `~/.copilot/extensions/<name>/extension.mjs`. That file runs in the CLI's own Node process, which cannot resolve `better-sqlite3` (a native addon) unless it's in the extension directory's `node_modules/`. Rather than duplicating or bundling native binaries, the installer writes a one-liner trampoline at the extension path that re-imports the real extension from the globally installed npm package:

```js
await import("/absolute/path/to/global/copilot-kaizen/extension.mjs");
```

The path is hardcoded at install time by `kaizen install`. Relative imports in the real `extension.mjs` (e.g., `./lib/db.mjs`) resolve relative to the real file, not the trampoline.

## Considered options

- **Copy node_modules/better-sqlite3 into the extension directory** — Fragile; native addons are platform-specific and tied to the Node ABI version.
- **Use `createRequire()` to resolve at runtime** — More complex, harder to debug, and solves a problem we don't have (the global path doesn't change unless the user reinstalls, which regenerates the trampoline).
- **Runtime resolve via `npm root -g`** — Adds a subprocess call on every session start; slower and can fail in non-standard npm setups.
