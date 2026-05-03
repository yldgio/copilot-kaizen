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
import os from 'node:os'

import {
  openDb,
  insertSession,
  updateSessionEnd,
  upsertEntry,
  insertToolLog,
  incrementSessionErrorCount,
  getSessionToolCounts,
  decayOldEntries,
  searchEntries,
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

    // Open DB (close stale handle if any)
    if (db) { try { db.close() } catch { /* ignore */ } }
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

    // Inject session-level context (falls back to global kaizen.md if no .kaizen/)
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

    // Close session record — read error_count from DB (accumulated by incrementSessionErrorCount)
    const row = db.prepare('SELECT error_count FROM kaizen_sessions WHERE session_id = ?').get(sessionId)
    updateSessionEnd(db, {
      sessionId,
      endReason: shutdownType,
      toolCount,
      failureCount,
      errorCount: row?.error_count ?? 0,
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
// SDK Tool definitions — exposed via joinSession({ tools })
// ---------------------------------------------------------------------------

/**
 * Handler for kaizen_remember tool. Saves a learning to the DB.
 * @param {{ category: string, content: string }} args
 * @returns {string}
 */
export async function handleRemember(args) {
  if (!db) return 'Kaizen DB not available — session may not have started yet.'
  if (!projectPath) return 'No project path — session may not have started yet.'

  const { category, content } = args ?? {}
  if (!category || !content) return 'Missing required fields: category and content.'

  upsertEntry(db, { projectPath, category, source: 'agent', content })

  // Exact-match lookup for hit count (not relying on fuzzy search which may miss low-hit entries)
  const current = db.prepare(
    'SELECT hit_count FROM kaizen_entries WHERE project_path = ? AND category = ? AND content = ?'
  ).get(projectPath, category, content)
  const hitInfo = current && current.hit_count > 1 ? ` (seen ${current.hit_count}x)` : ' (new)'

  let response = `✓ Saved ${category} entry${hitInfo}: "${content}"`

  // Show similar entries for dedup awareness (exclude the exact match)
  try {
    const similar = searchEntries(db, { projectPath, query: content.split(/\s+/).slice(0, 3).join(' '), limit: 3 })
    const others = similar.filter(e => e.content !== content)
    if (others.length > 0) {
      response += '\n\nSimilar existing entries:'
      for (const e of others) {
        response += `\n  #${e.id} [${e.category}] (${e.hit_count}x): ${e.content}`
      }
    }
  } catch { /* non-critical — dedup hint is best-effort */ }
  return response
}

/**
 * Handler for kaizen_search tool. Queries existing learnings.
 * @param {{ query: string, category?: string, limit?: number }} args
 * @returns {string}
 */
export async function handleSearch(args) {
  if (!db) return 'Kaizen DB not available — session may not have started yet.'
  if (!projectPath) return 'No project path — session may not have started yet.'

  const { query, category, limit: rawLimit } = args ?? {}
  if (!query) return 'Missing required field: query.'

  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10

  let results
  try {
    results = searchEntries(db, { projectPath, query, category, limit })
  } catch {
    return 'Search failed — database error.'
  }

  if (results.length === 0) return `No entries found matching "${query}".`

  let response = `Found ${results.length} entries:`
  for (const e of results) {
    const cryst = e.crystallized ? ' ★' : ''
    response += `\n  #${e.id} [${e.category}] (${e.hit_count}x${cryst}): ${e.content}`
  }
  return response
}

export const TOOL_DEFINITIONS = [
  {
    name: 'kaizen_remember',
    description:
      'Save a project-specific learning to kaizen memory. Call this when: ' +
      'the user corrects you, teaches a convention or preference, ' +
      'or you discover a recurring pattern. ' +
      'Do NOT save transient facts or things already in .kaizen/ files.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description:
            'Category for this learning (e.g. mistake, convention, ' +
            'pattern, memory, preference — or any custom category).',
        },
        content: {
          type: 'string',
          description: 'The learning to save. Be specific and actionable.',
        },
      },
      required: ['category', 'content'],
    },
    handler: handleRemember,
  },
  {
    name: 'kaizen_search',
    description:
      'Search existing kaizen learnings for this project. ' +
      'Use before saving to avoid duplicates, or to recall project conventions.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword to search for in entry content.',
        },
        category: {
          type: 'string',
          description: 'Optional: filter by category.',
        },
        limit: {
          type: 'integer',
          description: 'Max results (default 10).',
        },
      },
      required: ['query'],
    },
    handler: handleSearch,
  },
]


