// extension.mjs — Copilot CLI extension for copilot-kaizen
//
// Copied to .github/extensions/kaizen/extension.mjs by `kaizen install`.
// Injected into every Copilot CLI session at start time.
//
// CONSTRAINT: Self-contained. Only imports compress.mjs (zero native deps).
//             Session-context logic is INLINED — do not import inject.mjs.
// CONSTRAINT: Must NEVER throw. All operations in try/catch.
// CONSTRAINT: Returns { additionalContext: string } or {}.

import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Inline helpers (duplicated from lib/project.mjs to avoid dependency chain)
// ---------------------------------------------------------------------------

/**
 * Resolve the git repository root for a given working directory.
 * Falls back to cwd itself if not inside a git repo.
 * @param {string} cwd
 * @returns {string}
 */
function getProjectRoot(cwd) {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return cwd
  }
}

// ---------------------------------------------------------------------------
// Extension export: onSessionStart
// ---------------------------------------------------------------------------

/**
 * Called by Copilot CLI when a session starts.
 * Reads kaizen memory files and returns them as additionalContext.
 *
 * Resolution order:
 *   1. <projectRoot>/.kaizen/kaizen.md   (index)
 *   2. <projectRoot>/.kaizen/general.md  (conventions)
 *   3. If neither exists: ~/.copilot/kaizen/kaizen.md (global fallback)
 *
 * @param {object} [event] — the session-start event from Copilot CLI
 * @returns {Promise<{ additionalContext?: string }>}
 */
export async function onSessionStart(event) {
  try {
    const { compressText } = await import('./lib/compress.mjs')
    const cwd = event?.cwd ?? process.cwd()
    const projectRoot = getProjectRoot(cwd)
    const kaizenDir = path.join(projectRoot, '.kaizen')
    const globalDir = path.join(os.homedir(), '.copilot', 'kaizen')

    const parts = []

    // Project-local kaizen files
    const kaizenMd = path.join(kaizenDir, 'kaizen.md')
    const generalMd = path.join(kaizenDir, 'general.md')

    if (fs.existsSync(kaizenMd)) {
      parts.push(fs.readFileSync(kaizenMd, 'utf8'))
    }
    if (fs.existsSync(generalMd)) {
      parts.push(fs.readFileSync(generalMd, 'utf8'))
    }

    // Global fallback — only if no project-local files found
    if (parts.length === 0) {
      const globalKaizenMd = path.join(globalDir, 'kaizen.md')
      if (fs.existsSync(globalKaizenMd)) {
        parts.push(fs.readFileSync(globalKaizenMd, 'utf8'))
      }
    }

    // Nothing found — return empty object
    if (parts.length === 0) return {}

    // Assemble and compress
    const assembled = parts.join('\n\n---\n\n')
    const compressed = compressText(assembled, 8000)

    return { additionalContext: compressed }
  } catch {
    // CONSTRAINT: Must NEVER throw — return empty object on any error
    return {}
  }
}
