// lib/db.mjs — SQLite database layer for copilot-kaizen
// Single runtime dependency: sql.js (pure WASM — no native binaries)
// DB location: ~/.copilot/kaizen/kaizen.db (user-global, project-isolated via project_path column)

import initSqlJs from 'sql.js'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const SQL = await initSqlJs()

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Return the absolute path to the kaizen database file.
 * @returns {string}
 */
export function getDbPath() {
  return process.env.KAIZEN_DB_PATH ?? path.join(os.homedir(), '.copilot', 'kaizen', 'kaizen.db')
}

// ---------------------------------------------------------------------------
// Internal query helpers (sql.js prepare → step → getAsObject → free)
// ---------------------------------------------------------------------------

function _all(db, sql, params) {
  const stmt = db.prepare(sql)
  if (params) stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function _get(db, sql, params) {
  const stmt = db.prepare(sql)
  if (params) stmt.bind(params)
  const row = stmt.step() ? stmt.getAsObject() : undefined
  stmt.free()
  return row
}

// ---------------------------------------------------------------------------
// Schema + migrations
// ---------------------------------------------------------------------------

/**
 * Create all tables, indexes, and run forward-only migrations.
 * Every ALTER is wrapped in try/catch so that re-running is idempotent.
 */
function initSchema(db) {
  // ---- Core tables --------------------------------------------------------
  db.run(`
    CREATE TABLE IF NOT EXISTS kaizen_sessions (
      session_id    TEXT PRIMARY KEY,
      project_path  TEXT NOT NULL DEFAULT '',
      repo          TEXT,
      started_at    TEXT DEFAULT (datetime('now')),
      ended_at      TEXT,
      source        TEXT,
      end_reason    TEXT,
      tool_count    INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      error_count   INTEGER DEFAULT 0
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_ks_project ON kaizen_sessions (project_path)`)

  db.run(`
    CREATE TABLE IF NOT EXISTS kaizen_tool_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT NOT NULL,
      project_path TEXT NOT NULL DEFAULT '',
      tool_name    TEXT NOT NULL,
      event_type   TEXT NOT NULL,
      ts           TEXT DEFAULT (datetime('now'))
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_ktl_project_tool ON kaizen_tool_log (project_path, tool_name)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_ktl_project_type ON kaizen_tool_log (project_path, event_type)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_ktl_ts ON kaizen_tool_log (ts)`)

  db.run(`
    CREATE TABLE IF NOT EXISTS kaizen_entries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path    TEXT NOT NULL DEFAULT '',
      category        TEXT NOT NULL,
      source          TEXT NOT NULL DEFAULT 'auto',
      content         TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now')),
      last_seen       TEXT DEFAULT (datetime('now')),
      hit_count       INTEGER DEFAULT 1,
      crystallized    INTEGER DEFAULT 0,
      crystallized_at TEXT,
      applied_count   INTEGER DEFAULT 0,
      last_applied_at TEXT
    )
  `)
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_upsert ON kaizen_entries (project_path, category, content)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_ke_project_cat ON kaizen_entries (project_path, category, hit_count DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_ke_crystallized ON kaizen_entries (crystallized)`)

  // ---- v2 forward-only migrations -----------------------------------------
  const alters = [
    `ALTER TABLE kaizen_sessions ADD COLUMN project_path TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE kaizen_tool_log ADD COLUMN project_path TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE kaizen_entries  ADD COLUMN project_path TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE kaizen_tool_log ADD COLUMN event_type TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE kaizen_entries  ADD COLUMN applied_count   INTEGER DEFAULT 0`,
    `ALTER TABLE kaizen_entries  ADD COLUMN last_applied_at TEXT`,
    `ALTER TABLE kaizen_entries  ADD COLUMN crystallized_at TEXT`,
  ]
  for (const sql of alters) {
    try { db.run(sql) } catch { /* column already exists — expected */ }
  }

  // ---- Backfill event_type from legacy `result` column --------------------
  try {
    db.run(`
      UPDATE kaizen_tool_log
         SET event_type = result
       WHERE event_type = '' AND result IS NOT NULL
    `)
  } catch {
    // `result` column may not exist on fresh installs — that's fine
  }

  // ---- Drop legacy tables -------------------------------------------------
  db.run(`DROP TABLE IF EXISTS kaizen_procedures`)
}

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

/**
 * Open (or create) the kaizen database and ensure the schema is up to date.
 * Returns a sql.js Database with close() that auto-persists to disk.
 */
export function openDb(customPath) {
  const dbPath = customPath ?? getDbPath()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database()

  db.run("PRAGMA foreign_keys = ON")
  initSchema(db)

  // Persist schema to disk
  fs.writeFileSync(dbPath, Buffer.from(db.export()))

  // Override close() to auto-save before closing
  const origClose = db.close.bind(db)
  db.close = () => {
    try { fs.writeFileSync(dbPath, Buffer.from(db.export())) } catch {}
    origClose()
  }

  return db
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

export function insertSession(db, { sessionId, projectPath, repo, source }) {
  db.run(`
    INSERT OR IGNORE INTO kaizen_sessions (session_id, project_path, repo, source)
    VALUES (?, ?, ?, ?)
  `, [sessionId, projectPath, repo ?? null, source ?? 'new'])
}

export function updateSessionEnd(db, { sessionId, endReason, toolCount, failureCount, errorCount }) {
  db.run(`
    UPDATE kaizen_sessions
       SET ended_at      = datetime('now'),
           end_reason    = ?,
           tool_count    = ?,
           failure_count = ?,
           error_count   = ?
     WHERE session_id = ?
  `, [endReason, toolCount, failureCount, errorCount, sessionId])
}

export function upsertEntry(db, { projectPath, category, source, content }) {
  db.run(`
    INSERT INTO kaizen_entries (project_path, category, source, content)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_path, category, content) DO UPDATE SET
      hit_count = hit_count + 1,
      last_seen = datetime('now')
  `, [projectPath, category, source ?? 'auto', content])
}

export function insertToolLog(db, { sessionId, projectPath, toolName, eventType }) {
  db.run(`
    INSERT INTO kaizen_tool_log (session_id, project_path, tool_name, event_type)
    VALUES (?, ?, ?, ?)
  `, [sessionId, projectPath, toolName, eventType])
}

export function getTopEntriesForSynthesis(db, projectPath, limit = 30) {
  return _all(db, `
    SELECT id, category, content, hit_count, last_seen
      FROM kaizen_entries
     WHERE project_path = ?
     ORDER BY hit_count DESC, last_seen DESC
     LIMIT ?
  `, [projectPath, limit])
}

export function searchEntries(db, { projectPath, query, category, limit = 10 }) {
  let sql = `
    SELECT id, category, content, hit_count, crystallized, last_seen
      FROM kaizen_entries
     WHERE project_path = ?`
  const params = [projectPath]

  if (category) {
    sql += ` AND category = ?`
    params.push(category)
  }
  if (query) {
    sql += ` AND content LIKE ? ESCAPE '\\'`
    const escaped = query.replace(/[%_\\]/g, c => '\\' + c)
    params.push(`%${escaped}%`)
  }

  sql += ` ORDER BY hit_count DESC, last_seen DESC LIMIT ?`
  params.push(limit)

  return _all(db, sql, params)
}

export function getToolFailureSummary(db, projectPath) {
  return _all(db, `
    SELECT tool_name, COUNT(*) as fail_count
      FROM kaizen_tool_log
     WHERE project_path = ?
       AND event_type = 'post:failure'
     GROUP BY tool_name
     ORDER BY fail_count DESC
     LIMIT 10
  `, [projectPath])
}

export function markEntriesCrystallized(db, ids) {
  if (!ids.length) return
  const placeholders = ids.map(() => '?').join(', ')
  db.run(`
    UPDATE kaizen_entries
       SET crystallized = 1,
           crystallized_at = datetime('now')
     WHERE id IN (${placeholders})
  `, ids)
}

export function decayOldEntries(db, projectPath) {
  db.run(`
    DELETE FROM kaizen_tool_log
     WHERE ts < datetime('now', '-7 days')
  `)
  db.run(`
    DELETE FROM kaizen_entries
     WHERE project_path = ?
       AND hit_count < 3
       AND crystallized = 0
       AND applied_count = 0
       AND created_at < datetime('now', '-60 days')
  `, [projectPath])
}

export function incrementSessionErrorCount(db, sessionId) {
  db.run(`
    UPDATE kaizen_sessions
       SET error_count = error_count + 1
     WHERE session_id = ?
  `, [sessionId])
}

export function getSessionToolCounts(db, sessionId) {
  const total = _get(db, `
    SELECT COUNT(*) as toolCount
      FROM kaizen_tool_log
     WHERE session_id = ?
       AND event_type != 'pre'
  `, [sessionId])
  const fails = _get(db, `
    SELECT COUNT(*) as failureCount
      FROM kaizen_tool_log
     WHERE session_id = ?
       AND event_type = 'post:failure'
  `, [sessionId])

  return {
    toolCount: total?.toolCount ?? 0,
    failureCount: fails?.failureCount ?? 0,
  }
}

// --- Functions moved from extension.mjs (eliminate raw db.prepare calls) ---

export function getFrequentlyFailingTools(db, sessionId) {
  return _all(db, `
    SELECT tool_name, COUNT(*) as n FROM kaizen_tool_log
    WHERE session_id = ? AND event_type = 'post:failure'
    GROUP BY tool_name HAVING n >= 3
  `, [sessionId])
}

export function getSessionErrorCount(db, sessionId) {
  const row = _get(db, `
    SELECT error_count FROM kaizen_sessions WHERE session_id = ?
  `, [sessionId])
  return row?.error_count ?? 0
}

export function getEntryHitCount(db, { projectPath, category, content }) {
  const row = _get(db, `
    SELECT hit_count FROM kaizen_entries
    WHERE project_path = ? AND category = ? AND content = ?
  `, [projectPath, category, content])
  return row?.hit_count ?? 0
}
