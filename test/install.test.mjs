// test/install.test.mjs — Tests for the installer (bin/install.mjs)

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const RUN_ID = `${process.pid}-${Date.now()}`
const TEST_DIR = path.join(os.tmpdir(), `kaizen-install-test-${RUN_ID}`)
const EXT_DIR = path.join(os.homedir(), '.copilot', 'extensions', 'kaizen')

function cleanUp() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
  fs.rmSync(EXT_DIR, { recursive: true, force: true })
}

describe('installer', () => {
  afterEach(() => cleanUp())

  it('install creates .kaizen/, trampoline, and skills', async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true })
    // Create a minimal git repo so getProjectRoot works
    fs.mkdirSync(path.join(TEST_DIR, '.git'), { recursive: true })

    const { install } = await import('../bin/install.mjs')
    await install(TEST_DIR)

    // .kaizen/ structure
    assert.ok(fs.existsSync(path.join(TEST_DIR, '.kaizen', 'kaizen.md')))
    assert.ok(fs.existsSync(path.join(TEST_DIR, '.kaizen', 'general.md')))
    assert.ok(fs.existsSync(path.join(TEST_DIR, '.kaizen', 'tools')))
    assert.ok(fs.existsSync(path.join(TEST_DIR, '.kaizen', 'domain')))

    // Trampoline
    const trampolinePath = path.join(EXT_DIR, 'extension.mjs')
    assert.ok(fs.existsSync(trampolinePath), 'trampoline should exist')
    const content = fs.readFileSync(trampolinePath, 'utf8')
    assert.ok(content.includes('await import('), 'trampoline should use dynamic import')
    assert.ok(content.includes('extension.mjs'), 'trampoline should point to extension.mjs')
    assert.ok(content.includes('file:///'), 'trampoline must use file:// URL scheme for ESM compatibility')

    // Skills
    assert.ok(fs.existsSync(path.join(TEST_DIR, '.agents', 'skills', 'kaizen', 'SKILL.md')))
  })

  it('install removes legacy hooks artifacts', async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true })
    fs.mkdirSync(path.join(TEST_DIR, '.git'), { recursive: true })

    // Create legacy artifacts
    const legacyHooks = path.join(TEST_DIR, '.github', 'hooks', 'kaizen')
    const legacyJson = path.join(TEST_DIR, '.github', 'hooks', 'kaizen.json')
    const legacyExt = path.join(TEST_DIR, '.github', 'extensions', 'kaizen')
    fs.mkdirSync(legacyHooks, { recursive: true })
    fs.writeFileSync(legacyJson, '{}')
    fs.mkdirSync(legacyExt, { recursive: true })

    const { install } = await import('../bin/install.mjs')
    await install(TEST_DIR)

    assert.ok(!fs.existsSync(legacyHooks), 'legacy hooks dir should be removed')
    assert.ok(!fs.existsSync(legacyJson), 'legacy hooks json should be removed')
    assert.ok(!fs.existsSync(legacyExt), 'legacy extensions dir should be removed')
  })

  it('uninstall removes extension directory', async () => {
    // First install
    fs.mkdirSync(TEST_DIR, { recursive: true })
    fs.mkdirSync(path.join(TEST_DIR, '.git'), { recursive: true })

    const { install, uninstall } = await import('../bin/install.mjs')
    await install(TEST_DIR)
    assert.ok(fs.existsSync(EXT_DIR), 'extension should exist after install')

    await uninstall()
    assert.ok(!fs.existsSync(EXT_DIR), 'extension should be removed after uninstall')
  })
})
