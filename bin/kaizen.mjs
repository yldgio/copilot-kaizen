#!/usr/bin/env node

// bin/kaizen.mjs — CLI entry point for copilot-kaizen
//
// Commands:
//   kaizen install [dir]  — Set up kaizen in a project directory
//   kaizen update [dir]   — Force-update kaizen files (trampoline, skills)
//   kaizen uninstall      — Remove the extension trampoline
//   kaizen add <category> <content>  — Manually add a kaizen entry
//   kaizen list [category]           — List kaizen entries
//   kaizen mark <id>                 — Mark an entry as applied
//   kaizen sync                      — Force synthesis + index rebuild
//   kaizen reorganize                — Rebuild the kaizen.md index

import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const command = process.argv[2]
const args = process.argv.slice(3)

async function main() {
  switch (command) {
    case 'install':
      await runInstall(args)
      break

    case 'update':
      await runUpdate(args)
      break

    case 'uninstall':
      await runUninstall()
      break

    case 'add':
      await runAdd(args)
      break

    case 'list':
      await runList(args)
      break

    case 'mark':
      await runMark(args)
      break

    case 'sync':
      await runSync()
      break

    case 'reorganize':
      await runReorganize()
      break

    case '--help':
    case '-h':
    case undefined:
      printHelp()
      break

    default:
      console.error(`Unknown command: ${command}`)
      console.error('Run `kaizen --help` for usage.')
      process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// Command: install
// ---------------------------------------------------------------------------

async function runInstall(args) {
  const { install } = await import('./install.mjs')
  const dir = args[0] || process.cwd()
  await install(path.resolve(dir))
}

// ---------------------------------------------------------------------------
// Command: update [dir]
// ---------------------------------------------------------------------------

async function runUpdate(args) {
  const { update } = await import('./install.mjs')
  const dir = args[0] || process.cwd()
  await update(path.resolve(dir))
}

// ---------------------------------------------------------------------------
// Command: uninstall
// ---------------------------------------------------------------------------

async function runUninstall() {
  const { uninstall } = await import('./install.mjs')
  await uninstall()
}

// ---------------------------------------------------------------------------
// Command: add <category> <content>
// ---------------------------------------------------------------------------

async function runAdd(args) {
  if (args.length < 2) {
    console.error('Usage: kaizen add <category> <content>')
    console.error('Categories: mistake, pattern, memory, convention')
    process.exit(1)
  }

  const category = args[0]
  const content = args.slice(1).join(' ')

  const { openDb, upsertEntry } = await import('../lib/db.mjs')
  const { getProjectRoot } = await import('../lib/project.mjs')

  const db = openDb()
  const projectPath = getProjectRoot(process.cwd())

  upsertEntry(db, { projectPath, category, source: 'manual', content })
  db.close()

  console.log(`✓ Added ${category}: ${content}`)
}

// ---------------------------------------------------------------------------
// Command: list [category]
// ---------------------------------------------------------------------------

async function runList(args) {
  const category = args[0] || null

  const { openDb, listEntries } = await import('../lib/db.mjs')
  const { getProjectRoot } = await import('../lib/project.mjs')

  const db = openDb()
  const projectPath = getProjectRoot(process.cwd())

  const rows = listEntries(db, { projectPath, category, limit: 50 })

  db.close()

  if (!rows.length) {
    console.log('No entries found.')
    return
  }

  console.log(`\n${'ID'.padEnd(5)} ${'Cat'.padEnd(12)} ${'Hits'.padEnd(5)} ${'Cryst'.padEnd(6)} ${'Content'}`)
  console.log('-'.repeat(80))
  for (const row of rows) {
    const cryst = row.crystallized ? '★' : ' '
    const content = row.content.length > 50 ? row.content.slice(0, 47) + '...' : row.content
    console.log(
      `${String(row.id).padEnd(5)} ${row.category.padEnd(12)} ${String(row.hit_count).padEnd(5)} ${cryst.padEnd(6)} ${content}`
    )
  }
  console.log(`\n${rows.length} entries shown.`)
}

// ---------------------------------------------------------------------------
// Command: mark <id>
// ---------------------------------------------------------------------------

async function runMark(args) {
  const id = parseInt(args[0], 10)
  if (isNaN(id)) {
    console.error('Usage: kaizen mark <id>')
    process.exit(1)
  }

  const { openDb, markEntryApplied } = await import('../lib/db.mjs')
  const db = openDb()

  const changes = markEntryApplied(db, id)

  db.close()

  if (changes === 0) {
    console.error(`Entry ${id} not found.`)
    process.exit(1)
  }

  console.log(`✓ Marked entry ${id} as applied.`)
}

// ---------------------------------------------------------------------------
// Command: sync
// ---------------------------------------------------------------------------

async function runSync() {
  const { openDb } = await import('../lib/db.mjs')
  const { getProjectRoot, getKaizenDir, getGlobalKaizenDir } = await import('../lib/project.mjs')
  const { synthesize } = await import('../lib/synthesize.mjs')

  const cwd = process.cwd()
  const projectPath = getProjectRoot(cwd)
  const kaizenDir = getKaizenDir(projectPath)

  const db = openDb()
  synthesize({
    db,
    projectPath,
    kaizenDir,
    globalKaizenDir: getGlobalKaizenDir(),
  })
  db.close()

  console.log(`✓ Synthesis complete. Updated ${kaizenDir}`)
}

// ---------------------------------------------------------------------------
// Command: reorganize
// ---------------------------------------------------------------------------

async function runReorganize() {
  const { getProjectRoot, getKaizenDir } = await import('../lib/project.mjs')
  const { rebuildIndex } = await import('../lib/synthesize.mjs')

  const projectPath = getProjectRoot(process.cwd())
  const kaizenDir = getKaizenDir(projectPath)

  rebuildIndex(kaizenDir)
  console.log(`✓ Index rebuilt: ${path.join(kaizenDir, 'kaizen.md')}`)
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
copilot-kaizen — Continuous-improvement memory for Copilot CLI

USAGE:
  kaizen install [dir]          Set up kaizen in a project directory
  kaizen update [dir]           Force-update trampoline and skills
  kaizen uninstall              Remove the extension (preserves .kaizen/ and DB)
  kaizen add <category> <text>  Manually add a kaizen entry
  kaizen list [category]        List kaizen entries for this project
  kaizen mark <id>              Mark an entry as applied
  kaizen sync                   Force synthesis + index rebuild
  kaizen reorganize             Rebuild the kaizen.md index

CATEGORIES:
  mistake     Errors and bugs encountered
  pattern     Recurring patterns (good or bad)
  memory      Things to remember
  convention  Project conventions

EXAMPLES:
  kaizen install .
  kaizen update .
  kaizen uninstall
  kaizen add mistake "Forgot to handle null in auth middleware"
  kaizen add convention "Always use pino for logging"
  kaizen list mistake
  kaizen mark 42
  kaizen sync
`.trim())
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(err => {
  // Top-level catch — only for non-hook commands
  console.error('Error:', err.message)
  process.exit(1)
})
