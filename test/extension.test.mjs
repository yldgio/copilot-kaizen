// test/extension.test.mjs — Tests for kaizen lib functions
// Tests the DB, inject, and synthesize layers directly.
// extension.mjs is the SDK wiring layer — tested via live integration only.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import {
  openDb,
  insertSession,
  updateSessionEnd,
  upsertEntry,
  insertToolLog,
  incrementSessionErrorCount,
  getSessionToolCounts,
  searchEntries,
} from '../lib/db.mjs'

import {
  assembleSessionContext,
  assembleToolContext,
} from '../lib/inject.mjs'

import { getProjectRoot, getKaizenDir } from '../lib/project.mjs'

const RUN_ID = `${process.pid}-${Date.now()}`
const TEST_DIR = path.join(os.tmpdir(), `kaizen-test-${RUN_ID}`)
const KAIZEN_DIR = path.join(TEST_DIR, '.kaizen')
const TOOLS_DIR = path.join(KAIZEN_DIR, 'tools')
const DB_PATH = path.join(os.tmpdir(), `kaizen-test-${RUN_ID}.db`)
const sid = (name) => `${name}-${RUN_ID}`

let db

function setupFixtures() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true })
  fs.writeFileSync(path.join(KAIZEN_DIR, 'kaizen.md'), '# Test Kaizen Index\n- entry 1\n')
  fs.writeFileSync(path.join(KAIZEN_DIR, 'general.md'), '# General\nuse strict mode\n')
  fs.writeFileSync(path.join(TOOLS_DIR, 'edit.md'), '# Edit Tips\nalways check path exists\n')
}

function cleanFixtures() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
  try { fs.unlinkSync(DB_PATH) } catch {}
  try { fs.unlinkSync(DB_PATH + '-wal') } catch {}
  try { fs.unlinkSync(DB_PATH + '-shm') } catch {}
}

describe('kaizen core', () => {
  beforeEach(() => {
    setupFixtures()
    db = openDb(DB_PATH)
  })
  afterEach(() => {
    try { db.close() } catch {}
    cleanFixtures()
  })

  describe('session lifecycle', () => {
    it('inserts and updates a session record', () => {
      const id = sid('sess-1')
      insertSession(db, { sessionId: id, projectPath: TEST_DIR, repo: 'test-repo', source: 'new' })
      const row = db.prepare('SELECT * FROM kaizen_sessions WHERE session_id = ?').get(id)
      assert.ok(row)
      assert.equal(row.repo, 'test-repo')
      assert.equal(row.project_path, TEST_DIR)

      updateSessionEnd(db, { sessionId: id, endReason: 'routine', toolCount: 3, failureCount: 1, errorCount: 0 })
      const updated = db.prepare('SELECT * FROM kaizen_sessions WHERE session_id = ?').get(id)
      assert.ok(updated.ended_at)
      assert.equal(updated.end_reason, 'routine')
      assert.equal(updated.tool_count, 3)
    })

    it('increments error count', () => {
      const id = sid('err')
      insertSession(db, { sessionId: id, projectPath: TEST_DIR, repo: 'r', source: 'new' })
      incrementSessionErrorCount(db, id)
      incrementSessionErrorCount(db, id)
      const row = db.prepare('SELECT error_count FROM kaizen_sessions WHERE session_id = ?').get(id)
      assert.equal(row.error_count, 2)
    })
  })

  describe('tool logging', () => {
    it('inserts tool log and counts', () => {
      const id = sid('tools')
      insertSession(db, { sessionId: id, projectPath: TEST_DIR, repo: 'r', source: 'new' })
      insertToolLog(db, { sessionId: id, projectPath: TEST_DIR, toolName: 'edit', eventType: 'pre' })
      insertToolLog(db, { sessionId: id, projectPath: TEST_DIR, toolName: 'edit', eventType: 'post:success' })
      insertToolLog(db, { sessionId: id, projectPath: TEST_DIR, toolName: 'bash', eventType: 'pre' })
      insertToolLog(db, { sessionId: id, projectPath: TEST_DIR, toolName: 'bash', eventType: 'post:failure' })

      const { toolCount, failureCount } = getSessionToolCounts(db, id)
      assert.equal(toolCount, 2)
      assert.equal(failureCount, 1)
    })
  })

  describe('entries (remember/search)', () => {
    it('upserts and searches entries', () => {
      upsertEntry(db, { projectPath: TEST_DIR, category: 'convention', source: 'agent', content: 'Use pino for logging' })
      upsertEntry(db, { projectPath: TEST_DIR, category: 'mistake', source: 'auto', content: 'Forgot null check' })

      const results = searchEntries(db, { projectPath: TEST_DIR, query: 'pino', limit: 10 })
      assert.equal(results.length, 1)
      assert.ok(results[0].content.includes('pino'))
    })

    it('increments hit_count on duplicate', () => {
      upsertEntry(db, { projectPath: TEST_DIR, category: 'convention', source: 'agent', content: 'Use strict mode' })
      upsertEntry(db, { projectPath: TEST_DIR, category: 'convention', source: 'agent', content: 'Use strict mode' })

      const row = db.prepare("SELECT hit_count FROM kaizen_entries WHERE content = 'Use strict mode'").get()
      assert.equal(row.hit_count, 2)
    })

    it('filters by category', () => {
      upsertEntry(db, { projectPath: TEST_DIR, category: 'convention', source: 'test', content: 'Always use strict' })
      upsertEntry(db, { projectPath: TEST_DIR, category: 'mistake', source: 'test', content: 'Always check null' })

      const results = searchEntries(db, { projectPath: TEST_DIR, query: 'Always', category: 'convention', limit: 10 })
      assert.equal(results.length, 1)
      assert.ok(results[0].content.includes('strict'))
    })

    it('accepts any category', () => {
      upsertEntry(db, { projectPath: TEST_DIR, category: 'custom-cat', source: 'agent', content: 'custom entry' })
      const row = db.prepare("SELECT * FROM kaizen_entries WHERE category = 'custom-cat'").get()
      assert.ok(row)
    })

    it('accepts preference category', () => {
      upsertEntry(db, { projectPath: TEST_DIR, category: 'preference', source: 'agent', content: 'Respond in Italian' })
      const row = db.prepare("SELECT * FROM kaizen_entries WHERE category = 'preference'").get()
      assert.ok(row)
    })
  })

  describe('context injection', () => {
    it('assembles session context from .kaizen/ files', () => {
      const context = assembleSessionContext({ projectRoot: TEST_DIR, globalKaizenDir: '' })
      assert.ok(context)
      assert.ok(context.includes('Test Kaizen Index'))
      assert.ok(context.includes('use strict mode'))
    })

    it('injects per-category files', () => {
      fs.writeFileSync(path.join(KAIZEN_DIR, 'conventions.md'), '# Conventions\nuse camelCase\n')
      fs.writeFileSync(path.join(KAIZEN_DIR, 'mistakes.md'), '# Mistakes\ncheck null first\n')
      const context = assembleSessionContext({ projectRoot: TEST_DIR, globalKaizenDir: '' })
      assert.ok(context.includes('use camelCase'))
      assert.ok(context.includes('check null first'))
    })

    it('returns null when no .kaizen/ exists', () => {
      const emptyDir = path.join(os.tmpdir(), `kaizen-empty-${RUN_ID}`)
      fs.mkdirSync(emptyDir, { recursive: true })
      try {
        const context = assembleSessionContext({ projectRoot: emptyDir, globalKaizenDir: '' })
        assert.ok(!context, 'should return falsy when no .kaizen/ exists')
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true })
      }
    })

    it('assembles tool context from .kaizen/tools/<tool>.md', () => {
      const context = assembleToolContext({ toolName: 'edit', projectRoot: TEST_DIR, globalKaizenDir: '' })
      assert.ok(context)
      assert.ok(context.includes('Edit Tips'))
    })

    it('returns null for tool without guidance file', () => {
      const context = assembleToolContext({ toolName: 'unknown_tool', projectRoot: TEST_DIR, globalKaizenDir: '' })
      assert.equal(context, null)
    })
  })
})
