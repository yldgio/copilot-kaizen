// lib/db.mjs — SQLite database layer for copilot-kaizen
// Single runtime dependency: better-sqlite3
// DB location: ~/.copilot/kaizen/kaizen.db (user-global, project-isolated via project_path column)

import Database from 'better-sqlite3'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Return the absolute path to the kaizen database file.
 * @returns {string}
 */
export function getDbPath() {
  return path.join(os.homedir(), '.copilot', 'kaizen', 'kaizen.db')
}

// ---------------------------------------------------------------------------
// Schema + migrations
// ---------------------------------------------------------------------------

/**
 * Create all tables, indexes, and run forward-only migrations.
 * Every ALTER is wrapped in try/catch so that re-running is idempotent.
 * @param {import('better-sqlite3').Database} db
 */
function initSchema(db) {
  // ---- Core tables --------------------------------------------------------
  db.exec(`
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
    );
    CREATE INDEX IF NOT EXISTS idx_ks_project
      ON kaizen_sessions (project_path);

    CREATE TABLE IF NOT EXISTS kaizen_tool_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT NOT NULL,
      project_path TEXT NOT NULL DEFAULT '',
      tool_name    TEXT NOT NULL,
      event_type   TEXT NOT NULL,
      ts           TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ktl_project_tool
      ON kaizen_tool_log (project_path, tool_name);
    CREATE INDEX IF NOT EXISTS idx_ktl_project_type
      ON kaizen_tool_log (project_path, event_type);
    CREATE INDEX IF NOT EXISTS idx_ktl_ts
      ON kaizen_tool_log (ts);

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
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_upsert
      ON kaizen_entries (project_path, category, content);
    CREATE INDEX IF NOT EXISTS idx_ke_project_cat
      ON kaizen_entries (project_path, category, hit_count DESC);
    CREATE INDEX IF NOT EXISTS idx_ke_crystallized
      ON kaizen_entries (crystallized);
  `)

  // ---- v2 forward-only migrations -----------------------------------------
  // Each ALTER wrapped individually — if column already exists, the error is
  // silently swallowed. This is the standard better-sqlite3 migration pattern.

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
    try { db.exec(sql) } catch { /* column already exists — expected */ }
  }

  // ---- Backfill event_type from legacy `result` column --------------------
  try {
    db.exec(`
      UPDATE kaizen_tool_log
         SET event_type = result
       WHERE event_type = '' AND result IS NOT NULL
    `)
  } catch {
    // `result` column may not exist on fresh installs — that's fine
  }

  // ---- Drop legacy tables -------------------------------------------------
  db.exec(`DROP TABLE IF EXISTS kaizen_procedures`)
}

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

/**
 * Open (or create) the kaizen database and ensure the schema is up to date.
 * Always returns a ready-to-use Database instance.
 * @returns {import('better-sqlite3').Database}
 */
export function openDb() {
  const dbPath = getDbPath()
  const dbDir = path.dirname(dbPath)
  fs.mkdirSync(dbDir, { recursive: true })

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')

  initSchema(db)
  return db
}

// ---------------------------------------------------------------------------
// Prepared-statement query functions
// ---------------------------------------------------------------------------

/**
 * Insert a new session record. Silently ignores duplicates.
 * @param {import('better-sqlite3').Database} db
 * @param {{ sessionId: string, projectPath: string, repo: string, source: string }} p
 */
export function insertSession(db, { sessionId, projectPath, repo, source }) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO kaizen_sessions (session_id, project_path, repo, source)
    VALUES (?, ?, ?, ?)
  `)
  stmt.run(sessionId, projectPath, repo ?? null, source ?? 'new')
}

/**
 * Close out a session with final counts and reason.
 * @param {import('better-sqlite3').Database} db
 * @param {{ sessionId: string, endReason: string, toolCount: number, failureCount: number, errorCount: number }} p
 */
export function updateSessionEnd(db, { sessionId, endReason, toolCount, failureCount, errorCount }) {
  const stmt = db.prepare(`
    UPDATE kaizen_sessions
       SET ended_at      = datetime('now'),
           end_reason    = ?,
           tool_count    = ?,
           failure_count = ?,
           error_count   = ?
     WHERE session_id = ?
  `)
  stmt.run(endReason, toolCount, failureCount, errorCount, sessionId)
}

/**
 * Upsert a kaizen entry. If the exact (project_path, category, content) tuple
 * already exists, bumps hit_count and updates last_seen instead of inserting.
 * @param {import('better-sqlite3').Database} db
 * @param {{ projectPath: string, category: string, source: string, content: string }} p
 */
export function upsertEntry(db, { projectPath, category, source, content }) {
  const stmt = db.prepare(`
    INSERT INTO kaizen_entries (project_path, category, source, content)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_path, category, content) DO UPDATE SET
      hit_count = hit_count + 1,
      last_seen = datetime('now')
  `)
  stmt.run(projectPath, category, source ?? 'auto', content)
}

/**
 * Insert a tool-usage log entry.
 * @param {import('better-sqlite3').Database} db
 * @param {{ sessionId: string, projectPath: string, toolName: string, eventType: string }} p
 */
export function insertToolLog(db, { sessionId, projectPath, toolName, eventType }) {
  const stmt = db.prepare(`
    INSERT INTO kaizen_tool_log (session_id, project_path, tool_name, event_type)
    VALUES (?, ?, ?, ?)
  `)
  stmt.run(sessionId, projectPath, toolName, eventType)
}

/**
 * Retrieve the top entries for synthesis — ordered by frequency then recency.
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectPath
 * @param {number} [limit=30]
 * @returns {Array<{ id: number, category: string, content: string, hit_count: number, last_seen: string }>}
 */
export function getTopEntriesForSynthesis(db, projectPath, limit = 30) {
  const stmt = db.prepare(`
    SELECT id, category, content, hit_count, last_seen
      FROM kaizen_entries
     WHERE project_path = ?
       AND category IN ('mistake', 'pattern', 'memory')
     ORDER BY hit_count DESC, last_seen DESC
     LIMIT ?
  `)
  return stmt.all(projectPath, limit)
}

/**
 * Search kaizen entries for a project, with optional keyword and category filters.
 * @param {import('better-sqlite3').Database} db
 * @param {{ projectPath: string, query?: string, category?: string, limit?: number }} p
 * @returns {Array<{ id: number, category: string, content: string, hit_count: number, crystallized: number, last_seen: string }>}
 */
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

  return db.prepare(sql).all(...params)
}

/**
 * Return the top-10 failing tools for a project.
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectPath
 * @returns {Array<{ tool_name: string, fail_count: number }>}
 */
export function getToolFailureSummary(db, projectPath) {
  const stmt = db.prepare(`
    SELECT tool_name, COUNT(*) as fail_count
      FROM kaizen_tool_log
     WHERE project_path = ?
       AND event_type = 'post:failure'
     GROUP BY tool_name
     ORDER BY fail_count DESC
     LIMIT 10
  `)
  return stmt.all(projectPath)
}

/**
 * Mark a set of entry IDs as crystallized (promoted to long-term memory).
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} ids
 */
export function markEntriesCrystallized(db, ids) {
  if (!ids.length) return
  // Build placeholder string: (?, ?, ?)
  const placeholders = ids.map(() => '?').join(', ')
  const stmt = db.prepare(`
    UPDATE kaizen_entries
       SET crystallized = 1,
           crystallized_at = datetime('now')
     WHERE id IN (${placeholders})
  `)
  stmt.run(...ids)
}

/**
 * Decay old tool logs (>7 days) and stale entries (>60 days, low hit_count,
 * not crystallized, never applied).
 * @param {import('better-sqlite3').Database} db
 * @param {string} projectPath
 */
export function decayOldEntries(db, projectPath) {
  db.prepare(`
    DELETE FROM kaizen_tool_log
     WHERE ts < datetime('now', '-7 days')
  `).run()

  db.prepare(`
    DELETE FROM kaizen_entries
     WHERE project_path = ?
       AND hit_count < 3
       AND crystallized = 0
       AND applied_count = 0
       AND created_at < datetime('now', '-60 days')
  `).run(projectPath)
}

/**
 * Increment the error_count for a session.
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 */
export function incrementSessionErrorCount(db, sessionId) {
  const stmt = db.prepare(`
    UPDATE kaizen_sessions
       SET error_count = error_count + 1
     WHERE session_id = ?
  `)
  stmt.run(sessionId)
}

/**
 * Return aggregated tool counts for a session (total tools, failure count).
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 * @returns {{ toolCount: number, failureCount: number }}
 */
export function getSessionToolCounts(db, sessionId) {
  const totalStmt = db.prepare(`
    SELECT COUNT(*) as toolCount
      FROM kaizen_tool_log
     WHERE session_id = ?
       AND event_type != 'pre'
  `)
  const failStmt = db.prepare(`
    SELECT COUNT(*) as failureCount
      FROM kaizen_tool_log
     WHERE session_id = ?
       AND event_type = 'post:failure'
  `)

  const { toolCount } = totalStmt.get(sessionId) ?? { toolCount: 0 }
  const { failureCount } = failStmt.get(sessionId) ?? { failureCount: 0 }
  return { toolCount, failureCount }
}
