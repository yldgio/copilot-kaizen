// lib/inject.mjs — Tool context injection stubs (Phase 3)
// These will be fully implemented in Phase 3.

/**
 * Assemble context string for a given tool.
 * Phase 3 stub: always returns null (no context to inject).
 *
 * @param {{ toolName: string, projectRoot: string, globalKaizenDir: string }} _opts
 * @returns {string|null}
 */
export function assembleToolContext(_opts) {
  return null
}

/**
 * Check whether a tool has already been injected this session.
 * Phase 3 stub: always returns false.
 *
 * @param {string} _toolName
 * @param {string} _injectedFile
 * @returns {boolean}
 */
export function wasToolInjectedThisSession(_toolName, _injectedFile) {
  return false
}

/**
 * Mark a tool as injected for this session.
 * Phase 3 stub: no-op.
 *
 * @param {string} _toolName
 * @param {string} _injectedFile
 */
export function markToolInjected(_toolName, _injectedFile) {
  // no-op until Phase 3
}
