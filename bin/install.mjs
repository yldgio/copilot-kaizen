// bin/install.mjs — Installer for copilot-kaizen
//
// Called by: kaizen install [dir]  |  kaizen update [dir]  |  kaizen uninstall
//
// Steps:
//   1. Resolve all paths
//   2. Init .kaizen/ (idempotent)
//   3. Init ~/.copilot/kaizen/ (idempotent)
//   4. Write trampoline to ~/.copilot/extensions/kaizen/extension.mjs
//   5. Open DB (runs initSchema)
//   6. Add .gitignore entries (idempotent)
//   7. Install skills to .agents/skills/kaizen/
//   8. Print summary

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_ROOT = path.resolve(__dirname, '..')

/**
 * Install copilot-kaizen into a project directory.
 *
 * @param {string} projectDir — absolute path to the project root
 */
export async function install(projectDir) {
  console.log(`\n🔧 copilot-kaizen install`)
  console.log(`   Project: ${projectDir}`)
  console.log(`   OS: ${os.platform()} (${os.arch()})`)
  console.log('')

  // ---- Step 1: Resolve all paths ------------------------------------------
  const kaizenDir       = path.join(projectDir, '.kaizen')
  const kaizenToolsDir  = path.join(kaizenDir, 'tools')
  const kaizenDomainDir = path.join(kaizenDir, 'domain')
  const globalKaizenDir = path.join(os.homedir(), '.copilot', 'kaizen')
  const globalToolsDir  = path.join(globalKaizenDir, 'tools')
  const extensionDir    = path.join(os.homedir(), '.copilot', 'extensions', 'kaizen')

  // ---- Step 2: Init .kaizen/ (idempotent) ---------------------------------
  console.log('  [1/7] Initializing .kaizen/ directory...')

  fs.mkdirSync(kaizenToolsDir, { recursive: true })
  fs.mkdirSync(kaizenDomainDir, { recursive: true })

  const kaizenMdPath = path.join(kaizenDir, 'kaizen.md')
  if (!fs.existsSync(kaizenMdPath)) {
    const tmpl = fs.readFileSync(path.join(PACKAGE_ROOT, 'templates', 'kaizen.md.tmpl'), 'utf8')
    const content = tmpl
      .replace('{DATE}', new Date().toISOString().slice(0, 10))
      .replace('{INDEX_LINES}', '- general.md — conventions')
    fs.writeFileSync(kaizenMdPath, content, 'utf8')
    console.log('    ✓ Created .kaizen/kaizen.md')
  } else {
    console.log('    • .kaizen/kaizen.md already exists')
  }

  const generalMdPath = path.join(kaizenDir, 'general.md')
  if (!fs.existsSync(generalMdPath)) {
    fs.copyFileSync(
      path.join(PACKAGE_ROOT, 'templates', 'general.md.tmpl'),
      generalMdPath
    )
    console.log('    ✓ Created .kaizen/general.md')
  } else {
    console.log('    • .kaizen/general.md already exists')
  }

  // ---- Step 3: Init ~/.copilot/kaizen/ (idempotent) -----------------------
  console.log('  [2/7] Initializing global kaizen directory...')

  fs.mkdirSync(globalToolsDir, { recursive: true })
  console.log(`    ✓ ${globalKaizenDir}`)

  // ---- Step 4: Write trampoline -------------------------------------------
  console.log('  [3/7] Installing extension trampoline...')

  fs.mkdirSync(extensionDir, { recursive: true })

  const trampolinePath = path.join(extensionDir, 'extension.mjs')
  const realExtensionUrl = pathToFileURL(path.join(PACKAGE_ROOT, 'entrypoint.mjs')).href
  const trampolineContent = `// copilot-kaizen trampoline — DO NOT EDIT\n// Resolves native deps (better-sqlite3) from package node_modules\nawait import("${realExtensionUrl}");\n`
  fs.writeFileSync(trampolinePath, trampolineContent, 'utf8')
  console.log(`    ✓ ${trampolinePath}`)

  // ---- Step 5: Open DB (runs initSchema) ----------------------------------
  console.log('  [4/7] Initializing database...')

  const { openDb, getDbPath } = await import('../lib/db.mjs')
  const db = openDb()
  db.close()
  console.log(`    ✓ ${getDbPath()}`)

  // ---- Step 6: Add .gitignore entries (idempotent) ------------------------
  console.log('  [5/7] Updating .gitignore...')

  const gitignorePath = path.join(projectDir, '.gitignore')
  const entriesToAdd = [
    '# copilot-kaizen (DB is global at ~/.copilot/kaizen/kaizen.db)',
  ]

  let gitignoreContent = ''
  try {
    gitignoreContent = fs.readFileSync(gitignorePath, 'utf8')
  } catch { /* .gitignore doesn't exist */ }

  const linesToAdd = entriesToAdd.filter(line => !gitignoreContent.includes(line))
  if (linesToAdd.length > 0) {
    const suffix = gitignoreContent.endsWith('\n') ? '' : '\n'
    fs.appendFileSync(gitignorePath, suffix + linesToAdd.join('\n') + '\n', 'utf8')
    console.log('    ✓ Added kaizen entries to .gitignore')
  } else {
    console.log('    • .gitignore already has kaizen entries')
  }

  // ---- Step 7: Install skills ---------------------------------------------
  console.log('  [6/7] Installing skills...')

  const skillsSrcDir = path.join(PACKAGE_ROOT, 'skills', 'kaizen')
  const skillsDestDir = path.join(projectDir, '.agents', 'skills', 'kaizen')

  fs.mkdirSync(skillsDestDir, { recursive: true })

  const skillFiles = fs.readdirSync(skillsSrcDir)
  for (const file of skillFiles) {
    const src = path.join(skillsSrcDir, file)
    const dest = path.join(skillsDestDir, file)
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest)
      console.log(`    ✓ .agents/skills/kaizen/${file}`)
    } else {
      console.log(`    • .agents/skills/kaizen/${file} already exists, skipping`)
    }
  }

  // ---- Step 8: Clean up old hooks artifacts (migration) -------------------
  console.log('  [7/7] Cleaning up legacy hooks...')

  const legacyPaths = [
    path.join(projectDir, '.github', 'hooks', 'kaizen'),
    path.join(projectDir, '.github', 'hooks', 'kaizen.json'),
    path.join(projectDir, '.github', 'extensions', 'kaizen'),
  ]
  let cleaned = 0
  for (const p of legacyPaths) {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true })
      console.log(`    ✓ Removed ${path.relative(projectDir, p)}`)
      cleaned++
    }
  }
  if (cleaned === 0) console.log('    • No legacy artifacts found')

  // ---- Summary ------------------------------------------------------------
  console.log('')
  console.log('  ✅ copilot-kaizen installed successfully!')
  console.log('')
  console.log('  Files created/updated:')
  console.log('    .kaizen/kaizen.md              — Memory index')
  console.log('    .kaizen/general.md             — General conventions')
  console.log('    .kaizen/tools/                 — Per-tool guidance (empty)')
  console.log('    .kaizen/domain/                — Domain knowledge (empty)')
  console.log(`    ${trampolinePath}`)
  console.log(`    ${getDbPath()}  — SQLite database`)
  console.log('')
  console.log('  Next steps:')
  console.log('    1. Edit .kaizen/general.md with your project conventions')
  console.log('    2. Add tool-specific guidance to .kaizen/tools/<tool>.md')
  console.log('    3. Commit .kaizen/ and .agents/skills/kaizen/ to your repo')
  console.log('    4. Start a Copilot CLI session — kaizen will auto-inject context')
  console.log('')
}

/**
 * Force-update copilot-kaizen files in a project directory.
 * Always overwrites trampoline, skills. Never overwrites user content.
 *
 * @param {string} projectDir — absolute path to the project root
 */
export async function update(projectDir) {
  console.log(`\n🔄 copilot-kaizen update`)
  console.log(`   Project: ${projectDir}`)
  console.log(`   OS: ${os.platform()} (${os.arch()})`)
  console.log('')

  const kaizenDir       = path.join(projectDir, '.kaizen')
  const kaizenToolsDir  = path.join(kaizenDir, 'tools')
  const kaizenDomainDir = path.join(kaizenDir, 'domain')
  const globalKaizenDir = path.join(os.homedir(), '.copilot', 'kaizen')
  const globalToolsDir  = path.join(globalKaizenDir, 'tools')
  const extensionDir    = path.join(os.homedir(), '.copilot', 'extensions', 'kaizen')

  // .kaizen/ — create dirs, never overwrite user content
  console.log('  [1/5] Ensuring .kaizen/ directory...')
  fs.mkdirSync(kaizenToolsDir, { recursive: true })
  fs.mkdirSync(kaizenDomainDir, { recursive: true })

  const kaizenMdPath = path.join(kaizenDir, 'kaizen.md')
  if (!fs.existsSync(kaizenMdPath)) {
    const tmpl = fs.readFileSync(path.join(PACKAGE_ROOT, 'templates', 'kaizen.md.tmpl'), 'utf8')
    const content = tmpl
      .replace('{DATE}', new Date().toISOString().slice(0, 10))
      .replace('{INDEX_LINES}', '- general.md — conventions')
    fs.writeFileSync(kaizenMdPath, content, 'utf8')
    console.log('    ✓ Created .kaizen/kaizen.md')
  } else {
    console.log('    • .kaizen/kaizen.md (user content — not overwritten)')
  }

  const generalMdPath = path.join(kaizenDir, 'general.md')
  if (!fs.existsSync(generalMdPath)) {
    fs.copyFileSync(path.join(PACKAGE_ROOT, 'templates', 'general.md.tmpl'), generalMdPath)
    console.log('    ✓ Created .kaizen/general.md')
  } else {
    console.log('    • .kaizen/general.md (user content — not overwritten)')
  }

  // Global dir
  console.log('  [2/5] Ensuring global kaizen directory...')
  fs.mkdirSync(globalToolsDir, { recursive: true })
  console.log(`    ✓ ${globalKaizenDir}`)

  // Trampoline — always overwrite
  console.log('  [3/5] Updating extension trampoline...')
  fs.mkdirSync(extensionDir, { recursive: true })

  const trampolinePath = path.join(extensionDir, 'extension.mjs')
  const realExtensionUrl = pathToFileURL(path.join(PACKAGE_ROOT, 'entrypoint.mjs')).href
  const trampolineContent = `// copilot-kaizen trampoline — DO NOT EDIT\n// Resolves native deps (better-sqlite3) from package node_modules\nawait import("${realExtensionUrl}");\n`
  fs.writeFileSync(trampolinePath, trampolineContent, 'utf8')
  console.log(`    ✓ ${trampolinePath} (updated)`)

  // DB
  console.log('  [4/5] Ensuring database...')
  const { openDb, getDbPath } = await import('../lib/db.mjs')
  const db = openDb()
  db.close()
  console.log(`    ✓ ${getDbPath()}`)

  // Skills — always overwrite
  console.log('  [5/5] Updating skills...')
  const skillsSrcDir = path.join(PACKAGE_ROOT, 'skills', 'kaizen')
  const skillsDestDir = path.join(projectDir, '.agents', 'skills', 'kaizen')
  fs.mkdirSync(skillsDestDir, { recursive: true })

  const skillFiles = fs.readdirSync(skillsSrcDir)
  for (const file of skillFiles) {
    fs.copyFileSync(path.join(skillsSrcDir, file), path.join(skillsDestDir, file))
    console.log(`    ✓ .agents/skills/kaizen/${file} (updated)`)
  }

  // Clean up legacy hooks
  const legacyPaths = [
    path.join(projectDir, '.github', 'hooks', 'kaizen'),
    path.join(projectDir, '.github', 'hooks', 'kaizen.json'),
    path.join(projectDir, '.github', 'extensions', 'kaizen'),
  ]
  for (const p of legacyPaths) {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true })
      console.log(`    ✓ Removed legacy: ${path.relative(projectDir, p)}`)
    }
  }

  console.log('')
  console.log('  ✅ copilot-kaizen updated successfully!')
  console.log('')
}

/**
 * Uninstall copilot-kaizen — removes trampoline and global extension directory.
 * Does NOT remove .kaizen/ (user content) or DB (history).
 */
export async function uninstall() {
  const extensionDir = path.join(os.homedir(), '.copilot', 'extensions', 'kaizen')

  console.log(`\n🗑️  copilot-kaizen uninstall`)
  console.log('')

  if (fs.existsSync(extensionDir)) {
    fs.rmSync(extensionDir, { recursive: true, force: true })
    console.log(`  ✓ Removed ${extensionDir}`)
  } else {
    console.log(`  • Extension not installed at ${extensionDir}`)
  }

  console.log('')
  console.log('  ✅ Extension removed. Kaizen will no longer load in new sessions.')
  console.log('     .kaizen/ directory and database preserved (run manually to remove).')
  console.log('')
}
