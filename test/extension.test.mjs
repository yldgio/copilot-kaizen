// test/extension.test.mjs — Tests for the new extension.mjs
// Tests exercise handler functions directly (no SDK dependency)
//
// Uses __KAIZEN_TEST_MODE=1 to skip joinSession() call.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Set test mode BEFORE importing extension
process.env.__KAIZEN_TEST_MODE = '1'

const {
  onSessionStart,
  onPreToolUse,
  onPostToolUse,
  onErrorOccurred,
  onShutdown,
  _getDb,
  handleRemember,
  handleSearch,
  TOOL_DEFINITIONS,
} = await import('../extension.mjs')

// Test fixtures — unique prefix per run to avoid stale DB rows
const RUN_ID = `${process.pid}-${Date.now()}`
const TEST_DIR = path.join(os.tmpdir(), `kaizen-test-${RUN_ID}`)
const KAIZEN_DIR = path.join(TEST_DIR, '.kaizen')
const TOOLS_DIR = path.join(KAIZEN_DIR, 'tools')
const sid = (name) => `${name}-${RUN_ID}`

function setupFixtures() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true })
  fs.writeFileSync(path.join(KAIZEN_DIR, 'kaizen.md'), '# Test Kaizen Index\n- entry 1\n')
  fs.writeFileSync(path.join(KAIZEN_DIR, 'general.md'), '# General\nuse strict mode\n')
  fs.writeFileSync(path.join(TOOLS_DIR, 'edit.md'), '# Edit Tips\nalways check path exists\n')
}

function cleanFixtures() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
}

describe('extension handlers', () => {
  beforeEach(() => {
    setupFixtures()
  })
  afterEach(async () => {
    // Close DB if open (in case a test didn't call onShutdown)
    const db = _getDb()
    if (db) {
      try { db.close() } catch { /* already closed */ }
    }
    cleanFixtures()
  })

  describe('onSessionStart', () => {
    it('returns additionalContext when .kaizen/ exists', async () => {
      const data = { sessionId: sid('sess-1'), cwd: TEST_DIR }
      const result = await onSessionStart(data)
      assert.ok(result.additionalContext, 'should return additionalContext')
      assert.ok(result.additionalContext.includes('Test Kaizen Index'), 'should contain kaizen.md content')
    })

    it('injects per-category files into additionalContext', async () => {
      fs.writeFileSync(path.join(KAIZEN_DIR, 'conventions.md'), '# Conventions\nuse camelCase\n')
      fs.writeFileSync(path.join(KAIZEN_DIR, 'mistakes.md'), '# Mistakes\ncheck null first\n')
      const data = { sessionId: sid('sess-cat'), cwd: TEST_DIR }
      const result = await onSessionStart(data)
      assert.ok(result.additionalContext.includes('use camelCase'), 'should contain conventions')
      assert.ok(result.additionalContext.includes('check null first'), 'should contain mistakes')
    })

    it('returns empty object when .kaizen/ does not exist', async () => {
      const emptyDir = path.join(os.tmpdir(), `kaizen-empty-${RUN_ID}`)
      fs.mkdirSync(emptyDir, { recursive: true })
      try {
        const data = { sessionId: sid('sess-2'), cwd: emptyDir }
        const result = await onSessionStart(data)
        assert.deepEqual(result, {})
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true })
      }
    })

    it('opens DB and inserts session record', async () => {
      const id = sid('sess-3')
      const data = { sessionId: id, cwd: TEST_DIR }
      await onSessionStart(data)
      const db = _getDb()
      assert.ok(db, 'db should be open')
      const row = db.prepare('SELECT * FROM kaizen_sessions WHERE session_id = ?').get(id)
      assert.ok(row, 'session should be in DB')
      assert.ok(row.project_path.length > 0, 'project_path should be set')
    })

    it('returns empty when SKIP_KAIZEN=1', async () => {
      process.env.SKIP_KAIZEN = '1'
      try {
        const data = { sessionId: sid('skip'), cwd: TEST_DIR }
        const result = await onSessionStart(data)
        assert.deepEqual(result, {})
      } finally {
        delete process.env.SKIP_KAIZEN
      }
    })

    it('uses process.cwd() fallback when data.cwd is undefined', async () => {
      const data = { sessionId: sid('nocwd') }
      const result = await onSessionStart(data)
      assert.ok(result !== undefined, 'should not throw')
    })
  })

  describe('onPreToolUse', () => {
    it('returns additionalContext for tool with .kaizen/tools/<tool>.md', async () => {
      const id = sid('pre-tool')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const data = { sessionId: id, toolName: 'edit', toolArgs: '{}', cwd: TEST_DIR }
      const result = await onPreToolUse(data)
      assert.ok(result.additionalContext, 'should have additionalContext')
      assert.ok(result.additionalContext.includes('Edit Tips'), 'should contain tool-specific content')
    })

    it('returns empty for tool without .kaizen/tools/<tool>.md', async () => {
      const id = sid('pre-tool2')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const data = { sessionId: id, toolName: 'unknown_tool', toolArgs: '{}', cwd: TEST_DIR }
      const result = await onPreToolUse(data)
      assert.deepEqual(result, {})
    })

    it('does not inject same tool twice (dedup Set)', async () => {
      const id = sid('dedup')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const data = { sessionId: id, toolName: 'edit', toolArgs: '{}', cwd: TEST_DIR }
      const first = await onPreToolUse(data)
      assert.ok(first.additionalContext, 'first call should inject')
      const second = await onPreToolUse(data)
      assert.deepEqual(second, {}, 'second call should be empty (dedup)')
    })

    it('inserts tool log entry', async () => {
      const id = sid('log')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      await onPreToolUse({ sessionId: id, toolName: 'bash', toolArgs: '{}', cwd: TEST_DIR })
      const db = _getDb()
      const row = db.prepare("SELECT * FROM kaizen_tool_log WHERE session_id = ? AND tool_name = 'bash'").get(id)
      assert.ok(row, 'tool log entry should exist')
      assert.equal(row.event_type, 'pre')
    })

    it('does NOT return permissionDecision', async () => {
      const id = sid('no-perm')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const data = { sessionId: id, toolName: 'edit', toolArgs: '{}', cwd: TEST_DIR }
      const result = await onPreToolUse(data)
      assert.equal(result.permissionDecision, undefined, 'kaizen should never set permissionDecision')
    })

    it('returns empty when SKIP_KAIZEN=1', async () => {
      process.env.SKIP_KAIZEN = '1'
      try {
        const result = await onPreToolUse({ toolName: 'edit', toolArgs: '{}' })
        assert.deepEqual(result, {})
      } finally {
        delete process.env.SKIP_KAIZEN
      }
    })
  })

  describe('onPostToolUse', () => {
    it('logs success to DB', async () => {
      const id = sid('post')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      await onPostToolUse({
        sessionId: id,
        toolName: 'edit',
        toolArgs: {},
        toolResult: { resultType: 'success', textResultForLlm: 'done' },
        cwd: TEST_DIR,
      })
      const db = _getDb()
      const row = db.prepare("SELECT * FROM kaizen_tool_log WHERE session_id = ? AND event_type = 'post:success'").get(id)
      assert.ok(row, 'should log post:success')
    })

    it('logs failure to DB', async () => {
      const id = sid('post-fail')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      await onPostToolUse({
        sessionId: id,
        toolName: 'bash',
        toolArgs: {},
        toolResult: { resultType: 'failure', textResultForLlm: 'error' },
        cwd: TEST_DIR,
      })
      const db = _getDb()
      const row = db.prepare("SELECT * FROM kaizen_tool_log WHERE session_id = ? AND event_type = 'post:failure'").get(id)
      assert.ok(row, 'should log post:failure')
    })
  })

  describe('onErrorOccurred', () => {
    it('upserts mistake entry with string error', async () => {
      const id = sid('err')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      await onErrorOccurred({
        sessionId: id,
        error: 'TypeError: cannot read property of undefined',
        cwd: TEST_DIR,
      })
      const db = _getDb()
      const entry = db.prepare("SELECT * FROM kaizen_entries WHERE category = 'mistake' AND content LIKE '%TypeError%' AND project_path = ?").get(db.prepare("SELECT project_path FROM kaizen_sessions WHERE session_id = ?").get(id)?.project_path)
      assert.ok(entry, 'should have mistake entry containing TypeError')
    })

    it('upserts mistake entry with object error and increments error count', async () => {
      const id = sid('err2')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      await onErrorOccurred({
        sessionId: id,
        error: { name: 'RangeError', message: 'index out of bounds' },
        cwd: TEST_DIR,
      })
      const db = _getDb()
      const session = db.prepare("SELECT error_count FROM kaizen_sessions WHERE session_id = ?").get(id)
      assert.equal(session.error_count, 1)
    })
  })

  describe('onShutdown', () => {
    it('updates session end and closes DB', async () => {
      const id = sid('shutdown')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      await onPreToolUse({ sessionId: id, toolName: 'edit', toolArgs: '{}', cwd: TEST_DIR })
      await onPostToolUse({
        sessionId: id,
        toolName: 'edit',
        toolArgs: {},
        toolResult: { resultType: 'success', textResultForLlm: 'ok' },
        cwd: TEST_DIR,
      })
      await onShutdown({ shutdownType: 'routine' })

      // DB should be closed — reopen to verify
      const { openDb } = await import('../lib/db.mjs')
      const db = openDb()
      try {
        const row = db.prepare("SELECT * FROM kaizen_sessions WHERE session_id = ?").get(id)
        assert.ok(row.ended_at, 'ended_at should be set')
        assert.equal(row.end_reason, 'routine')
        assert.equal(row.tool_count, 1)
      } finally {
        db.close()
      }
    })

    it('maps shutdownType to end_reason', async () => {
      const id = sid('shutdown-type')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      await onShutdown({ shutdownType: 'error' })

      const { openDb } = await import('../lib/db.mjs')
      const db = openDb()
      try {
        const row = db.prepare("SELECT end_reason FROM kaizen_sessions WHERE session_id = ?").get(id)
        assert.equal(row.end_reason, 'error')
      } finally {
        db.close()
      }
    })

    it('preserves error_count accumulated by onErrorOccurred', async () => {
      const id = sid('err-preserve')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      // Trigger 2 errors
      await onErrorOccurred({ sessionId: id, error: 'err1', cwd: TEST_DIR })
      await onErrorOccurred({ sessionId: id, error: 'err2', cwd: TEST_DIR })
      await onShutdown({ shutdownType: 'routine' })

      const { openDb } = await import('../lib/db.mjs')
      const db = openDb()
      try {
        const row = db.prepare("SELECT error_count FROM kaizen_sessions WHERE session_id = ?").get(id)
        assert.equal(row.error_count, 2, 'shutdown must not overwrite error_count')
      } finally {
        db.close()
      }
    })

    it('handles double onSessionStart without leaking DB handles', async () => {
      const id1 = sid('dbl-start-1')
      const id2 = sid('dbl-start-2')
      await onSessionStart({ sessionId: id1, cwd: TEST_DIR })
      const db1 = _getDb()
      assert.ok(db1, 'first DB should be open')

      // Second onSessionStart should close the first handle
      await onSessionStart({ sessionId: id2, cwd: TEST_DIR })
      const db2 = _getDb()
      assert.ok(db2, 'second DB should be open')

      // Verify first handle is closed (throws if used)
      assert.throws(() => db1.prepare('SELECT 1'), /database.*not open|database.*closed/i,
        'first DB handle should be closed after second onSessionStart')
    })
  })

  describe('TOOL_DEFINITIONS', () => {
    it('exports two tool definitions with correct names', () => {
      assert.equal(TOOL_DEFINITIONS.length, 2)
      assert.equal(TOOL_DEFINITIONS[0].name, 'kaizen_remember')
      assert.equal(TOOL_DEFINITIONS[1].name, 'kaizen_search')
    })

    it('both tools have required schema fields', () => {
      for (const tool of TOOL_DEFINITIONS) {
        assert.ok(tool.description, `${tool.name} should have description`)
        assert.ok(tool.parameters, `${tool.name} should have parameters`)
        assert.ok(typeof tool.handler === 'function', `${tool.name} should have handler`)
      }
    })

    it('kaizen_remember requires category and content', () => {
      const tool = TOOL_DEFINITIONS[0]
      assert.deepEqual(tool.parameters.required, ['category', 'content'])
      assert.ok(tool.parameters.properties.category.enum.includes('preference'),
        'should include preference category')
    })

    it('kaizen_search requires only query', () => {
      const tool = TOOL_DEFINITIONS[1]
      assert.deepEqual(tool.parameters.required, ['query'])
    })
  })

  describe('handleRemember', () => {
    it('saves entry and returns confirmation', async () => {
      const id = sid('remember-1')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const result = await handleRemember({ category: 'convention', content: 'Always use pino for logging' })
      assert.ok(result.includes('✓ Saved convention entry'), result)
      assert.ok(result.includes('(new)'), 'first save should be marked as new')

      // Verify in DB
      const db = _getDb()
      const row = db.prepare("SELECT * FROM kaizen_entries WHERE content = 'Always use pino for logging'").get()
      assert.ok(row, 'entry should be in DB')
      assert.equal(row.source, 'agent')
    })

    it('returns hit count on duplicate save', async () => {
      const id = sid('remember-dup')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      await handleRemember({ category: 'mistake', content: 'Check null before .length' })
      const result = await handleRemember({ category: 'mistake', content: 'Check null before .length' })
      assert.ok(result.includes('(seen 2x)'), `should show hit count, got: ${result}`)
    })

    it('rejects invalid category', async () => {
      const id = sid('remember-bad')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const result = await handleRemember({ category: 'invalid', content: 'test' })
      assert.ok(result.includes('Invalid category'), result)
    })

    it('rejects missing fields', async () => {
      const id = sid('remember-missing')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const result = await handleRemember({})
      assert.ok(result.includes('Missing required'), result)
    })

    it('returns error when DB not available', async () => {
      // Force DB to null by calling shutdown first
      const id = sid('remember-nodb')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      await onShutdown({ shutdownType: 'routine' })
      const result = await handleRemember({ category: 'mistake', content: 'test' })
      assert.ok(result.includes('not available'), result)
    })

    it('accepts preference category', async () => {
      const id = sid('remember-pref')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const result = await handleRemember({ category: 'preference', content: 'Respond in Italian' })
      assert.ok(result.includes('✓ Saved preference entry'), result)
    })
  })

  describe('handleSearch', () => {
    it('finds entries by keyword', async () => {
      const id = sid('search-1')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const { upsertEntry } = await import('../lib/db.mjs')
      const db = _getDb()
      upsertEntry(db, { projectPath: TEST_DIR, category: 'convention', source: 'test', content: 'Use pino for all logging' })
      upsertEntry(db, { projectPath: TEST_DIR, category: 'mistake', source: 'test', content: 'Forgot to validate input' })

      const result = await handleSearch({ query: 'pino' })
      assert.ok(result.includes('pino'), result)
      assert.ok(!result.includes('validate'), 'should not match unrelated entries')
    })

    it('filters by category', async () => {
      const id = sid('search-cat')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const { upsertEntry } = await import('../lib/db.mjs')
      const db = _getDb()
      upsertEntry(db, { projectPath: TEST_DIR, category: 'convention', source: 'test', content: 'Always use strict mode' })
      upsertEntry(db, { projectPath: TEST_DIR, category: 'mistake', source: 'test', content: 'Always check return value' })

      const result = await handleSearch({ query: 'Always', category: 'convention' })
      assert.ok(result.includes('strict mode'), result)
      assert.ok(!result.includes('return value'), 'should filter by category')
    })

    it('returns no-match message', async () => {
      const id = sid('search-empty')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const result = await handleSearch({ query: 'xyznonexistent' })
      assert.ok(result.includes('No entries found'), result)
    })

    it('rejects missing query', async () => {
      const id = sid('search-noq')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const result = await handleSearch({})
      assert.ok(result.includes('Missing required'), result)
    })

    it('rejects invalid category', async () => {
      const id = sid('search-badcat')
      await onSessionStart({ sessionId: id, cwd: TEST_DIR })
      const result = await handleSearch({ query: 'test', category: 'bogus' })
      assert.ok(result.includes('Invalid category'), result)
    })
  })
})
