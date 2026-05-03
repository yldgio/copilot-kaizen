// test/synthesize.test.mjs — Tests for per-category synthesis pipeline

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { synthesize, rebuildIndex } from '../lib/synthesize.mjs'
import { openDb, upsertEntry } from '../lib/db.mjs'

const RUN_ID = `${process.pid}-${Date.now()}`
const TEST_DIR = path.join(os.tmpdir(), `kaizen-synth-${RUN_ID}`)
const KAIZEN_DIR = path.join(TEST_DIR, '.kaizen')
const PROJECT_PATH = TEST_DIR

let db
let testProjectPath

function seedEntries(entries) {
  for (const e of entries) {
    upsertEntry(db, { projectPath: testProjectPath, category: e.category, source: 'test', content: e.content })
    if (e.hits > 1) {
      for (let i = 1; i < e.hits; i++) upsertEntry(db, { projectPath: testProjectPath, category: e.category, source: 'test', content: e.content })
    }
  }
}

let testCounter = 0

describe('per-category synthesis', () => {
  beforeEach(() => {
    testCounter++
    testProjectPath = `${TEST_DIR}-t${testCounter}`
    fs.mkdirSync(path.join(KAIZEN_DIR, 'tools'), { recursive: true })
    fs.writeFileSync(path.join(KAIZEN_DIR, 'kaizen.md'), '# Kaizen Index\n')
    db = openDb()
  })

  afterEach(() => {
    try { db.close() } catch { /* already closed */ }
    fs.rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('creates per-category files for each category with entries', () => {
    seedEntries([
      { category: 'mistake', content: 'always check null', hits: 2 },
      { category: 'convention', content: 'use camelCase', hits: 1 },
      { category: 'preference', content: 'dark theme', hits: 1 },
      { category: 'pattern', content: 'retry on 429', hits: 3 },
      { category: 'memory', content: 'user prefers verbose', hits: 1 },
    ])

    synthesize({ db, projectPath: testProjectPath, kaizenDir: KAIZEN_DIR, globalKaizenDir: KAIZEN_DIR })

    assert.ok(fs.existsSync(path.join(KAIZEN_DIR, 'mistakes.md')), 'mistakes.md should exist')
    assert.ok(fs.existsSync(path.join(KAIZEN_DIR, 'conventions.md')), 'conventions.md should exist')
    assert.ok(fs.existsSync(path.join(KAIZEN_DIR, 'preferences.md')), 'preferences.md should exist')
    assert.ok(fs.existsSync(path.join(KAIZEN_DIR, 'patterns.md')), 'patterns.md should exist')
    assert.ok(fs.existsSync(path.join(KAIZEN_DIR, 'memories.md')), 'memories.md should exist')
  })

  it('writes entries to the correct category file', () => {
    seedEntries([
      { category: 'mistake', content: 'forgot to close DB', hits: 1 },
      { category: 'convention', content: 'use ESM imports', hits: 1 },
    ])

    synthesize({ db, projectPath: testProjectPath, kaizenDir: KAIZEN_DIR, globalKaizenDir: KAIZEN_DIR })

    const mistakes = fs.readFileSync(path.join(KAIZEN_DIR, 'mistakes.md'), 'utf8')
    assert.ok(mistakes.includes('forgot to close DB'), 'mistakes.md should contain the mistake entry')
    assert.ok(!mistakes.includes('use ESM imports'), 'mistakes.md should NOT contain convention entries')

    const conventions = fs.readFileSync(path.join(KAIZEN_DIR, 'conventions.md'), 'utf8')
    assert.ok(conventions.includes('use ESM imports'), 'conventions.md should contain the convention entry')
    assert.ok(!conventions.includes('forgot to close DB'), 'conventions.md should NOT contain mistake entries')
  })

  it('does not create files for categories with no entries', () => {
    seedEntries([
      { category: 'mistake', content: 'null pointer', hits: 1 },
    ])

    synthesize({ db, projectPath: testProjectPath, kaizenDir: KAIZEN_DIR, globalKaizenDir: KAIZEN_DIR })

    assert.ok(fs.existsSync(path.join(KAIZEN_DIR, 'mistakes.md')), 'mistakes.md should exist')
    assert.ok(!fs.existsSync(path.join(KAIZEN_DIR, 'conventions.md')), 'conventions.md should NOT exist')
    assert.ok(!fs.existsSync(path.join(KAIZEN_DIR, 'preferences.md')), 'preferences.md should NOT exist')
  })

  it('preserves human-authored content outside auto-block', () => {
    // Pre-create a file with human content
    fs.writeFileSync(
      path.join(KAIZEN_DIR, 'mistakes.md'),
      '# Mistakes\n\nHuman note: be careful with async.\n'
    )

    seedEntries([
      { category: 'mistake', content: 'race condition in DB', hits: 1 },
    ])

    synthesize({ db, projectPath: testProjectPath, kaizenDir: KAIZEN_DIR, globalKaizenDir: KAIZEN_DIR })

    const content = fs.readFileSync(path.join(KAIZEN_DIR, 'mistakes.md'), 'utf8')
    assert.ok(content.includes('Human note: be careful with async'), 'human content should be preserved')
    assert.ok(content.includes('race condition in DB'), 'auto-generated entry should be present')
    assert.ok(content.includes('<!-- kaizen:auto -->'), 'auto-block markers should be present')
  })

  it('updates existing auto-block on re-synthesis', () => {
    seedEntries([
      { category: 'pattern', content: 'first pattern', hits: 1 },
    ])

    synthesize({ db, projectPath: testProjectPath, kaizenDir: KAIZEN_DIR, globalKaizenDir: KAIZEN_DIR })

    let content = fs.readFileSync(path.join(KAIZEN_DIR, 'patterns.md'), 'utf8')
    assert.ok(content.includes('first pattern'))

    // Add another entry and re-synthesize
    seedEntries([
      { category: 'pattern', content: 'second pattern', hits: 1 },
    ])

    synthesize({ db, projectPath: testProjectPath, kaizenDir: KAIZEN_DIR, globalKaizenDir: KAIZEN_DIR })

    content = fs.readFileSync(path.join(KAIZEN_DIR, 'patterns.md'), 'utf8')
    assert.ok(content.includes('first pattern'), 'original entry should remain')
    assert.ok(content.includes('second pattern'), 'new entry should appear')

    // Only one auto-block
    const openMarkers = (content.match(/<!-- kaizen:auto -->/g) || []).length
    assert.equal(openMarkers, 1, 'should have exactly one auto-block')
  })

  it('includes all categories in rebuilt index', () => {
    seedEntries([
      { category: 'mistake', content: 'err1', hits: 1 },
      { category: 'convention', content: 'conv1', hits: 1 },
      { category: 'preference', content: 'pref1', hits: 1 },
    ])

    synthesize({ db, projectPath: testProjectPath, kaizenDir: KAIZEN_DIR, globalKaizenDir: KAIZEN_DIR })

    const index = fs.readFileSync(path.join(KAIZEN_DIR, 'kaizen.md'), 'utf8')
    assert.ok(index.includes('mistakes.md'), 'index should reference mistakes.md')
    assert.ok(index.includes('conventions.md'), 'index should reference conventions.md')
    assert.ok(index.includes('preferences.md'), 'index should reference preferences.md')
  })

  it('does not skip convention and preference entries (regression)', () => {
    seedEntries([
      { category: 'convention', content: 'always use strict', hits: 3 },
      { category: 'preference', content: 'prefer dark mode', hits: 2 },
    ])

    synthesize({ db, projectPath: testProjectPath, kaizenDir: KAIZEN_DIR, globalKaizenDir: KAIZEN_DIR })

    assert.ok(fs.existsSync(path.join(KAIZEN_DIR, 'conventions.md')), 'conventions.md must exist')
    assert.ok(fs.existsSync(path.join(KAIZEN_DIR, 'preferences.md')), 'preferences.md must exist')

    const conv = fs.readFileSync(path.join(KAIZEN_DIR, 'conventions.md'), 'utf8')
    assert.ok(conv.includes('always use strict'), 'convention entry must be written')

    const pref = fs.readFileSync(path.join(KAIZEN_DIR, 'preferences.md'), 'utf8')
    assert.ok(pref.includes('prefer dark mode'), 'preference entry must be written')
  })

  it('skips synthesis when .kaizen/ does not exist', () => {
    fs.rmSync(KAIZEN_DIR, { recursive: true, force: true })

    // Should not throw
    synthesize({ db, projectPath: testProjectPath, kaizenDir: KAIZEN_DIR, globalKaizenDir: KAIZEN_DIR })

    assert.ok(!fs.existsSync(KAIZEN_DIR), '.kaizen/ should not be created by synthesize')
  })
})
