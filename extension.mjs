// extension.mjs — Copilot CLI SDK extension for copilot-kaizen
//
// Loaded via trampoline at ~/.copilot/extensions/kaizen/extension.mjs
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
  searchEntries,
  getFrequentlyFailingTools,
  getSessionErrorCount,
  getEntryHitCount,
} from './lib/db.mjs'

import {
  assembleSessionContext,
  assembleToolContext,
} from './lib/inject.mjs'

import { synthesize } from './lib/synthesize.mjs'
import { getProjectRoot, getKaizenDir, getGlobalKaizenDir } from './lib/project.mjs'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let db = null
let sessionId = null
let projectPath = null
let cwd = null
let injectedTools = new Set()

function isSkipped() {
  return process.env.SKIP_KAIZEN === '1'
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function onSessionStart(data) {
  if (isSkipped()) return {}
  try {
    cwd = path.resolve(data?.cwd ?? process.cwd())
    projectPath = getProjectRoot(cwd)
    sessionId = data?.sessionId ?? `kaizen_${Date.now()}_${process.pid}`
    injectedTools = new Set()

    if (db) { try { db.close() } catch {} }
    db = openDb()

    let repo
    try {
      const remoteUrl = execSync('git remote get-url origin', {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      repo = path.basename(remoteUrl, '.git')
    } catch {
      repo = path.basename(cwd)
    }

    insertSession(db, { sessionId, projectPath, repo, source: data?.source ?? 'new' })

    const context = assembleSessionContext({
      projectRoot: projectPath,
      globalKaizenDir: getGlobalKaizenDir(),
    })

    if (!context) return {}
    return { additionalContext: context }
  } catch (e) {
    await session.log(`[kaizen] onSessionStart error: ${e.message}`, { level: 'error' })
    return {}
  }
}

async function onPreToolUse(data) {
  if (isSkipped()) return {}
  try {
    const toolName = data?.toolName ?? 'unknown'

    if (db) {
      try { insertToolLog(db, { sessionId, projectPath, toolName, eventType: 'pre' }) } catch(e) {
        session.log(`[kaizen] failed to log tool use: ${toolName}`, { level: 'warning' })
      }
    }

    if (injectedTools.has(toolName)) return {}

    // Guard: projectPath is null after hot-reload (onSessionStart not re-called).
    // Lazy-init from cwd so the extension recovers without a full session restart.
    if (!projectPath) {
      try {
        projectPath = getProjectRoot(path.resolve(process.cwd()))
      } catch { return {} }
      if (!projectPath) return {}
    }

    const kaizenDir = getKaizenDir(projectPath)
    if (!fs.existsSync(kaizenDir)) return {}

    const context = assembleToolContext({
      toolName, projectRoot: projectPath, globalKaizenDir: getGlobalKaizenDir(),
    })

    if (!context) {
      await session.log(`[kaizen] no context assembled for tool: ${toolName}`, { level: 'warning' })
      return {}
    }
    injectedTools.add(toolName)
    return { additionalContext: context }
  } catch (e) {
    await session.log(`[kaizen] onPreToolUse error: ${e.message}`, { level: 'error' })
    return {}
  }
}

async function onPostToolUse(data) {
  if (isSkipped()) return
  try {
    const toolName = data?.toolName ?? 'unknown'
    const resultType = data?.toolResult?.resultType ?? 'unknown'
    const eventType = { success: 'post:success', failure: 'post:failure', denied: 'post:denied' }[resultType] ?? 'post:unknown'
    if (db) insertToolLog(db, { sessionId, projectPath, toolName, eventType })
  } catch (e) {
    await session.log(`[kaizen] onPostToolUse error: ${e.message}`, { level: 'error' })
  }
}

async function onErrorOccurred(data) {
  if (isSkipped()) return
  try {
    const error = data?.error
    const content = typeof error === 'string'
      ? error
      : `[${error?.name ?? 'Error'}] ${error?.message ?? 'unknown'}`

    if (db) {
      upsertEntry(db, { projectPath, category: 'mistake', source: 'auto', content })
      incrementSessionErrorCount(db, sessionId)
    }
  } catch (e) {
    await session.log(`[kaizen] onErrorOccurred error: ${e.message}`, { level: 'error' })
  }
}

async function onShutdown(data) {
  if (isSkipped()) return
  try {
    if (!db) return
    const shutdownType = data?.shutdownType ?? 'routine'
    const { toolCount, failureCount } = getSessionToolCounts(db, sessionId)

    try {
      const failedTools = getFrequentlyFailingTools(db, sessionId)
      for (const row of failedTools) {
        upsertEntry(db, {
          projectPath, category: 'pattern', source: 'auto',
          content: `Tool ${row.tool_name} failed ${row.n} times in a single session`,
        })
      }
    } catch {}

    if (shutdownType !== 'error') {
      try {
        const kaizenDir = getKaizenDir(projectPath)
        if (fs.existsSync(kaizenDir)) {
          synthesize({ db, projectPath, kaizenDir, globalKaizenDir: getGlobalKaizenDir() })
        }
      } catch {}
    }

    try { decayOldEntries(db, projectPath) } catch {}

    const errorCount = getSessionErrorCount(db, sessionId)
    updateSessionEnd(db, {
      sessionId, endReason: shutdownType, toolCount, failureCount,
      errorCount,
    })

    db.close()
    db = null
  } catch {}
}

async function handleRemember(args) {
  if (!db) return 'Kaizen DB not available — session may not have started yet.'
  if (!projectPath) return 'No project path — session may not have started yet.'

  const { category, content } = args ?? {}
  if (!category || !content) return 'Missing required fields: category and content.'

  upsertEntry(db, { projectPath, category, source: 'agent', content })

  const hitCount = getEntryHitCount(db, { projectPath, category, content })
  const hitInfo = hitCount > 1 ? ` (seen ${hitCount}x)` : ' (new)'

  let response = `✓ Saved ${category} entry${hitInfo}: "${content}"`

  try {
    const similar = searchEntries(db, { projectPath, query: content.split(/\s+/).slice(0, 3).join(' '), limit: 3 })
    const others = similar.filter(e => e.content !== content)
    if (others.length > 0) {
      response += '\n\nSimilar existing entries:'
      for (const e of others) {
        response += `\n  #${e.id} [${e.category}] (${e.hit_count}x): ${e.content}`
      }
    }
  } catch {}
  return response
}

async function handleSearch(args) {
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

const TOOL_DEFINITIONS = [
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
          description: 'Category for this learning (e.g. mistake, convention, pattern, memory, preference — or any custom category).',
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
        query: { type: 'string', description: 'Keyword to search for in entry content.' },
        category: { type: 'string', description: 'Optional: filter by category.' },
        limit: { type: 'integer', description: 'Max results (default 10).' },
      },
      required: ['query'],
    },
    handler: handleSearch,
  },
]

// ---------------------------------------------------------------------------
// SDK wiring — session.log() for observability
// ---------------------------------------------------------------------------

const { joinSession } = await import('@github/copilot-sdk/extension')

const session = await joinSession({
  hooks: {
    onSessionStart: async (data) => {
      const result = await onSessionStart(data)
      const chars = result?.additionalContext?.length ?? 0
      await session.log(`[kaizen] session start — injected ${chars} chars`)
      return result
    },
    onPreToolUse: async (data) => {
      const result = await onPreToolUse(data)
      if (result?.additionalContext) {
        await session.log(`[kaizen] injected context for tool: ${data?.toolName}`)
      }
      return result
    },
    onPostToolUse,
    onErrorOccurred: async (data) => {
      await onErrorOccurred(data)
      const msg = typeof data?.error === 'string' ? data.error : data?.error?.message ?? 'unknown'
      await session.log(`[kaizen] error recorded: ${msg}`, { level: 'warning' })
    },
  },
  tools: TOOL_DEFINITIONS,
})

session.on('session.shutdown', async (event) => {
  await onShutdown(event?.data ?? event)
  await session.log('[kaizen] shutdown complete')
})

await session.log('[kaizen] extension ready')
