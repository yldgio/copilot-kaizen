// extension.mjs — Copilot CLI SDK extension for copilot-kaizen
//
// Loaded by the CLI runtime via trampoline at ~/.copilot/extensions/kaizen/extension.mjs
// Top-level ESM — no activate(), no export default.
//
// INVARIANT: Must NEVER throw. All hook bodies wrapped in try/catch.
// INVARIANT: onPreToolUse never returns permissionDecision — kaizen injects context only.

import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

import {
  openDb,
  insertSession,
  updateSessionEnd,
  upsertEntry,
  insertToolLog,
  incrementSessionErrorCount,
  getSessionToolCounts,
  decayOldEntries,
} from './lib/db.mjs'

import {
  assembleSessionContext,
  assembleToolContext,
} from './lib/inject.mjs'

import { synthesize } from './lib/synthesize.mjs'
import { getProjectRoot, getKaizenDir, getGlobalKaizenDir } from './lib/project.mjs'

// ---------------------------------------------------------------------------
// Module-scoped state (extension is long-lived, single process)
// ---------------------------------------------------------------------------

let db = null
let sessionId = null
let projectPath = null
let cwd = null
let injectedTools = new Set()

// ---------------------------------------------------------------------------
// Kill-switch
// ---------------------------------------------------------------------------

function isSkipped() {
  return process.env.SKIP_KAIZEN === '1'
}

// ---------------------------------------------------------------------------
// Exported hook handlers (testable without SDK)
// ---------------------------------------------------------------------------

/**
 * @param {object} data — StartData from SDK: { sessionId, cwd, copilotVersion, ... }
 * @returns {{ additionalContext?: string } | {}}
 */
export async function onSessionStart(data) {
  if (isSkipped()) return {}
  try {
    cwd = path.resolve(data?.cwd ?? process.cwd())
    projectPath = getProjectRoot(cwd)
    sessionId = data?.sessionId ?? `kaizen_${Date.now()}_${process.pid}`
    injectedTools = new Set()

    // Open DB
    db = openDb()

    // Derive repo name
    let repo
    try {
      const remoteUrl = execSync('git remote get-url origin', {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      repo = path.basename(remoteUrl, '.git')
    } catch {
      repo = path.basename(cwd)
    }

    // Insert session record
    insertSession(db, {
      sessionId,
      projectPath,
      repo,
      source: data?.source ?? 'new',
    })

    // Inject session-level context only if .kaizen/ exists
    const kaizenDir = getKaizenDir(projectPath)
    if (!fs.existsSync(kaizenDir)) return {}

    const context = assembleSessionContext({
      projectRoot: projectPath,
      globalKaizenDir: getGlobalKaizenDir(),
    })

    if (!context) return {}
    return { additionalContext: context }
  } catch {
    return {}
  }
}

/**
 * @param {object} data — { sessionId, timestamp, cwd, toolName, toolArgs (JSON string) }
 * @returns {{ additionalContext?: string } | {}}
 */
export async function onPreToolUse(data) {
  if (isSkipped()) return {}
  try {
    const toolName = data?.toolName ?? 'unknown'

    // DB log (fire-and-forget)
    if (db) {
      try {
        insertToolLog(db, { sessionId, projectPath, toolName, eventType: 'pre' })
      } catch { /* swallow */ }
    }

    // Injection guard: once per tool per session
    if (injectedTools.has(toolName)) return {}

    // Check if .kaizen/ exists for injection
    const kaizenDir = getKaizenDir(projectPath)
    if (!fs.existsSync(kaizenDir)) return {}

    const context = assembleToolContext({
      toolName,
      projectRoot: projectPath,
      globalKaizenDir: getGlobalKaizenDir(),
    })

    if (!context) return {}

    injectedTools.add(toolName)
    return { additionalContext: context }
  } catch {
    return {}
  }
}

/**
 * @param {object} data — { sessionId, timestamp, cwd, toolName, toolArgs (object), toolResult: { resultType, textResultForLlm } }
 */
export async function onPostToolUse(data) {
  if (isSkipped()) return
  try {
    const toolName = data?.toolName ?? 'unknown'
    const resultType = data?.toolResult?.resultType ?? 'unknown'
    const eventTypeMap = {
      success: 'post:success',
      failure: 'post:failure',
      denied: 'post:denied',
    }
    const eventType = eventTypeMap[resultType] ?? 'post:unknown'

    if (db) {
      insertToolLog(db, { sessionId, projectPath, toolName, eventType })
    }
  } catch { /* swallow */ }
}

/**
 * @param {object} data — { error: string | { name, message }, ... }
 */
export async function onErrorOccurred(data) {
  if (isSkipped()) return
  try {
    const error = data?.error
    let content
    if (typeof error === 'string') {
      content = error
    } else {
      const errorName = error?.name ?? 'Error'
      const errorMessage = error?.message ?? 'unknown'
      content = `[${errorName}] ${errorMessage}`
    }

    if (db) {
      upsertEntry(db, {
        projectPath,
        category: 'mistake',
        source: 'auto',
        content,
      })
      incrementSessionErrorCount(db, sessionId)
    }
  } catch { /* swallow */ }
}

/**
 * Called from session.on("session.shutdown") event handler.
 * @param {object} data — ShutdownData: { shutdownType, totalPremiumRequests, ... }
 */
export async function onShutdown(data) {
  if (isSkipped()) return
  try {
    if (!db) return

    const shutdownType = data?.shutdownType ?? 'routine'

    // Aggregate tool counts
    const { toolCount, failureCount } = getSessionToolCounts(db, sessionId)

    // Extract tool-failure insights
    try {
      const failedTools = db.prepare(`
        SELECT tool_name, COUNT(*) as n
          FROM kaizen_tool_log
         WHERE session_id = ?
           AND event_type = 'post:failure'
         GROUP BY tool_name
        HAVING n >= 3
      `).all(sessionId)

      for (const row of failedTools) {
        upsertEntry(db, {
          projectPath,
          category: 'pattern',
          source: 'auto',
          content: `Tool ${row.tool_name} failed ${row.n} times in a single session`,
        })
      }
    } catch { /* non-critical */ }

    // Synthesis (skip on error shutdowns)
    if (shutdownType !== 'error') {
      try {
        const kaizenDir = getKaizenDir(projectPath)
        if (fs.existsSync(kaizenDir)) {
          synthesize({
            db,
            projectPath,
            kaizenDir,
            globalKaizenDir: getGlobalKaizenDir(),
          })
        }
      } catch { /* synthesis failure must not propagate */ }
    }

    // Decay old entries
    try {
      decayOldEntries(db, projectPath)
    } catch { /* non-critical */ }

    // Close session record
    updateSessionEnd(db, {
      sessionId,
      endReason: shutdownType,
      toolCount,
      failureCount,
      errorCount: 0, // already tracked incrementally
    })

    // Close DB
    db.close()
    db = null
  } catch { /* swallow */ }
}

// ---------------------------------------------------------------------------
// Test helper — expose DB for test assertions
// ---------------------------------------------------------------------------

export function _getDb() {
  return db
}

// ---------------------------------------------------------------------------
// SDK integration — top-level joinSession call
// Only runs when NOT in test mode.
// ---------------------------------------------------------------------------

if (!process.env.__KAIZEN_TEST_MODE) {
  try {
    const { joinSession } = await import('@github/copilot-sdk/extension')

    const session = await joinSession({
      hooks: {
        onSessionStart,
        onPreToolUse,
        onPostToolUse,
        onErrorOccurred,
      },
    })

    session.on('session.shutdown', (event) => {
      onShutdown(event?.data ?? event)
    })
  } catch (e) {
    // Extension load failure must not crash the CLI
    // This happens in dev environments where SDK isn't installed
  }
}

