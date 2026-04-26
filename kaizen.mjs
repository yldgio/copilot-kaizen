// kaizen.mjs — Hook dispatcher for copilot-kaizen
// Invoked by: bin/kaizen.mjs hook <event>   (reads stdin JSON, dispatches to handler)
//
// INVARIANT: preToolUse stdout is always valid JSON.
// INVARIANT: All other hooks produce no stdout.
// INVARIANT: Crash-to-success — uncaught errors exit 0 to never block Copilot.
// INVARIANT: DB writes in preToolUse are fire-and-forget (setImmediate). Stdout first.

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

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
  getProjectRoot,
  getKaizenDir,
  getGlobalKaizenDir,
  getSessionTmpFile,
  getInjectedTmpFile,
} from './lib/project.mjs'

import {
  assembleToolContext,
  wasToolInjectedThisSession,
  markToolInjected,
} from './lib/inject.mjs'

import { synthesize } from './lib/synthesize.mjs'

// ---------------------------------------------------------------------------
// Crash-to-success — MUST be at the very top of module execution
// ---------------------------------------------------------------------------
process.on('uncaughtException', () => process.exit(0))
process.on('unhandledRejection', () => process.exit(0))

// ---------------------------------------------------------------------------
// Kill-switch: SKIP_KAIZEN=1 in env → do nothing
// ---------------------------------------------------------------------------
if (process.env.SKIP_KAIZEN === '1') process.exit(0)

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

const DISPATCH = {
  sessionStart:  handleSessionStart,
  sessionEnd:    handleSessionEnd,
  preToolUse:    handlePreToolUse,
  postToolUse:   handlePostToolUse,
  errorOccurred: handleErrorOccurred,
}

// ---------------------------------------------------------------------------
// Handler: sessionStart
// ---------------------------------------------------------------------------

/**
 * Create a session record, write session ID to temp file.
 * No stdout.
 *
 * @param {object} event — parsed stdin JSON
 * @param {import('better-sqlite3').Database} db
 */
function handleSessionStart(event, db) {
  const cwd = event.cwd ?? process.cwd()
  const projectPath = getProjectRoot(cwd)

  // Derive repo name from git remote, fallback to dir basename
  let repo
  try {
    const remoteUrl = execSync(`git -C "${cwd}" remote get-url origin`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    repo = path.basename(remoteUrl, '.git')
  } catch {
    repo = path.basename(cwd)
  }

  // Generate a unique session ID: YYYYMMDDHHmmssSSS_PID
  const sessionId =
    new Date().toISOString().replace(/\D/g, '').slice(0, 15) +
    '_' +
    process.pid

  // Persist session ID to tmp file so other hooks can read it
  const tmpFile = getSessionTmpFile(cwd)
  fs.writeFileSync(tmpFile, sessionId, 'utf8')

  // Only insert a DB record for new sessions (not resumes)
  if (event.source !== 'resume') {
    insertSession(db, {
      sessionId,
      projectPath,
      repo,
      source: event.source ?? 'new',
    })
  }

  // No stdout for sessionStart
}

// ---------------------------------------------------------------------------
// Handler: sessionEnd
// ---------------------------------------------------------------------------

/**
 * Finalize session: update DB record, extract tool-failure insights,
 * run synthesis, decay old entries, clean up temp files.
 * No stdout.
 *
 * @param {object} event — parsed stdin JSON
 * @param {import('better-sqlite3').Database} db
 */
function handleSessionEnd(event, db) {
  const cwd = event.cwd ?? process.cwd()
  const projectPath = getProjectRoot(cwd)

  // Read session ID from tmp file
  let sessionId = 'unknown'
  try {
    sessionId = fs.readFileSync(getSessionTmpFile(cwd), 'utf8').trim()
  } catch {
    // tmp file missing — degrade gracefully
  }

  // Aggregate tool counts for this session
  const { toolCount, failureCount } = getSessionToolCounts(db, sessionId)

  // Close the session record
  updateSessionEnd(db, {
    sessionId,
    endReason: event.reason ?? 'complete',
    toolCount,
    failureCount,
    errorCount: 0, // already tracked via incrementSessionErrorCount
  })

  // Extract tool-failure insights: if a tool failed 3+ times in this session,
  // record that as a "pattern" entry for future synthesis
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
  } catch {
    // Non-critical — swallow
  }

  // Run synthesis unless the session was aborted/timed out
  if (event.reason !== 'abort' && event.reason !== 'timeout') {
    try {
      synthesize({
        db,
        projectPath,
        kaizenDir: getKaizenDir(projectPath),
        globalKaizenDir: getGlobalKaizenDir(),
      })
    } catch {
      // Synthesis failure must not propagate
    }
  }

  // Decay old entries
  try {
    decayOldEntries(db, projectPath)
  } catch {
    // Non-critical
  }

  // Clean up temp files
  fs.rmSync(getSessionTmpFile(cwd), { force: true })
  fs.rmSync(getInjectedTmpFile(cwd), { force: true })

  // No stdout for sessionEnd
}

// ---------------------------------------------------------------------------
// Handler: preToolUse
// ---------------------------------------------------------------------------

/**
 * Inject per-tool context if available. Always outputs valid JSON to stdout.
 * DB writes are fire-and-forget — stdout must be emitted first.
 *
 * @param {object} event — parsed stdin JSON
 * @param {import('better-sqlite3').Database} db
 */
function handlePreToolUse(event, db) {
  const cwd = event.cwd ?? process.cwd()
  const toolName = event.toolName ?? 'unknown'
  const projectPath = getProjectRoot(cwd)

  // Read session ID (graceful if missing)
  let sessionId = 'unknown'
  try {
    sessionId = fs.readFileSync(getSessionTmpFile(cwd), 'utf8').trim()
  } catch {
    // No session tmp file — degrade
  }

  // Injection guard: only inject context once per tool per session
  const injectedFile = getInjectedTmpFile(cwd)
  const alreadyInjected = wasToolInjectedThisSession(toolName, injectedFile)

  let context = null
  if (!alreadyInjected) {
    context = assembleToolContext({
      toolName,
      projectRoot: projectPath,
      globalKaizenDir: getGlobalKaizenDir(),
    })
    if (context) {
      markToolInjected(toolName, injectedFile)
    }
  }

  // ---- STDOUT FIRST (synchronous) ----
  // INVARIANT: preToolUse stdout is always valid JSON
  const out = { permissionDecision: 'allow' }
  if (context) {
    out.additionalContext = context
  }
  process.stdout.write(JSON.stringify(out) + '\n')

  // ---- DB WRITE: fire-and-forget ----
  // setImmediate ensures stdout is flushed before any DB work
  setImmediate(() => {
    try {
      insertToolLog(db, { sessionId, projectPath, toolName, eventType: 'pre' })
    } catch {
      // Swallow — must never block
    }
  })
}

// ---------------------------------------------------------------------------
// Handler: postToolUse
// ---------------------------------------------------------------------------

/**
 * Log tool result (success/failure/denied).
 * No stdout.
 *
 * @param {object} event — parsed stdin JSON
 * @param {import('better-sqlite3').Database} db
 */
function handlePostToolUse(event, db) {
  const cwd = event.cwd ?? process.cwd()
  const toolName = event.toolName ?? 'unknown'
  const projectPath = getProjectRoot(cwd)

  // Read session ID (graceful if missing)
  let sessionId = 'unknown'
  try {
    sessionId = fs.readFileSync(getSessionTmpFile(cwd), 'utf8').trim()
  } catch {
    // degrade
  }

  // Map resultType to our event_type enum
  const resultType = event.toolResult?.resultType ?? 'unknown'
  const eventTypeMap = {
    success: 'post:success',
    failure: 'post:failure',
    denied:  'post:denied',
  }
  const eventType = eventTypeMap[resultType] ?? 'post:unknown'

  insertToolLog(db, { sessionId, projectPath, toolName, eventType })

  // No stdout for postToolUse
}

// ---------------------------------------------------------------------------
// Handler: errorOccurred
// ---------------------------------------------------------------------------

/**
 * Record the error as a kaizen entry (category: mistake) and bump the session
 * error count.
 * No stdout.
 *
 * @param {object} event — parsed stdin JSON
 * @param {import('better-sqlite3').Database} db
 */
function handleErrorOccurred(event, db) {
  const cwd = event.cwd ?? process.cwd()
  const projectPath = getProjectRoot(cwd)

  // Read session ID
  let sessionId = 'unknown'
  try {
    sessionId = fs.readFileSync(getSessionTmpFile(cwd), 'utf8').trim()
  } catch {
    // degrade
  }

  const errorName = event.error?.name ?? 'Error'
  const errorMessage = event.error?.message ?? 'unknown'
  const content = `[${errorName}] ${errorMessage}`

  upsertEntry(db, {
    projectPath,
    category: 'mistake',
    source: 'auto',
    content,
  })

  incrementSessionErrorCount(db, sessionId)

  // No stdout for errorOccurred
}

// ---------------------------------------------------------------------------
// Main entry (exported for bin/kaizen.mjs to call)
// ---------------------------------------------------------------------------

/**
 * Read stdin, parse event, dispatch to the correct handler.
 * Exported so bin/kaizen.mjs can `import { dispatch } from '../kaizen.mjs'`.
 *
 * @param {string} eventName — one of: sessionStart, sessionEnd, preToolUse, postToolUse, errorOccurred
 * @param {string} stdinData — raw stdin JSON string
 */
export async function dispatch(eventName, stdinData) {
  // Unknown event → exit silently
  const handler = DISPATCH[eventName]
  if (!handler) return

  let event
  try {
    event = JSON.parse(stdinData)
  } catch {
    // Malformed JSON → exit silently (crash-to-success)
    return
  }

  const db = openDb()
  try {
    await handler(event, db)
  } finally {
    // Give fire-and-forget writes a tick to complete
    await new Promise(resolve => setImmediate(resolve))
    db.close()
  }
}
