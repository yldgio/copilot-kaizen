# sql.js replaces better-sqlite3

Supersedes: ADR-0002 (Trampoline pattern for native dependencies)

`better-sqlite3` is a native C++ addon compiled against a specific Node.js ABI version (`NODE_MODULE_VERSION`). Copilot CLI bundles its own Node.js runtime whose ABI version doesn't match any publicly available Node release — so there's no way to `npm rebuild` the addon to work. Every Copilot CLI update risks breaking the extension with a `NODE_MODULE_VERSION` mismatch.

We replace `better-sqlite3` with `sql.js`, a pure JavaScript/WASM SQLite implementation that works with any Node.js version. The trampoline pattern (ADR-0002) remains for ESM path resolution, but its original motivation — native dependency resolution — is gone.

## Considered options

- **Rebuild better-sqlite3 for each Copilot CLI release** — Impossible: the CLI's bundled Node binary is not available for `node-gyp` to target. The user would need to reverse-engineer the ABI version and cross-compile.
- **Bundle prebuilt binaries for multiple ABI versions** — Fragile and unbounded: Copilot CLI updates are frequent and unpredictable, each potentially requiring a new binary.
- **Use a different native SQLite binding (e.g., better-sqlite3-multiple-ciphers)** — Same underlying problem: any native addon is tied to a specific ABI.

## Consequences

- **No native compilation required.** `npm install` works on any platform without `node-gyp`, Python, or a C++ compiler.
- **Persistence model changed.** sql.js operates in-memory; the database is loaded from disk on open and written back on close. There is no WAL mode and no concurrent access protection — acceptable because kaizen runs one session at a time.
- **API differs.** `db.prepare(sql).get(params)` (better-sqlite3) becomes a custom `_get(db, sql, params)` helper using sql.js's `prepare/bind/step/getAsObject/free` cycle. Query functions are exported from `lib/db.mjs` so callers never touch the raw sql.js API.
- **WASM binary bundled.** sql.js includes a ~1.2MB WASM file in its npm package. This increases `node_modules` size but eliminates platform-specific binaries.
