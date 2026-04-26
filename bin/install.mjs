// bin/install.mjs — Installer for copilot-kaizen
//
// Called by: kaizen install [dir]
//
// Steps:
//   1. Detect OS
//   2. Resolve all paths
//   3. Init .kaizen/ (idempotent)
//   4. Init ~/.copilot/kaizen/ (idempotent)
//   5. Copy hook wrapper scripts to .github/hooks/kaizen/
//   6. Write .github/hooks/kaizen.json (only if not exists)
//   7. Copy extension.mjs + lib/compress.mjs to .github/extensions/kaizen/
//   8. Open DB (runs initSchema)
//   9. Add .gitignore entries (idempotent)
//  10. Print summary

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_ROOT = path.resolve(__dirname, '..')

/**
 * Install copilot-kaizen into a project directory.
 *
 * @param {string} projectDir — absolute path to the project root
 */
export async function install(projectDir) {
  const isWindows = os.platform() === 'win32'

  console.log(`\n🔧 copilot-kaizen install`)
  console.log(`   Project: ${projectDir}`)
  console.log(`   OS: ${os.platform()} (${os.arch()})`)
  console.log('')

  // ---- Step 1: Detect OS (already done above) ----------------------------

  // ---- Step 2: Resolve all paths ------------------------------------------
  const kaizenDir         = path.join(projectDir, '.kaizen')
  const kaizenToolsDir    = path.join(kaizenDir, 'tools')
  const kaizenDomainDir   = path.join(kaizenDir, 'domain')
  const globalKaizenDir   = path.join(os.homedir(), '.copilot', 'kaizen')
  const globalToolsDir    = path.join(globalKaizenDir, 'tools')
  const githubDir         = path.join(projectDir, '.github')
  const hooksInstallDir   = path.join(githubDir, 'hooks', 'kaizen')
  const hooksJsonPath     = path.join(githubDir, 'hooks', 'kaizen.json')
  const extensionDir      = path.join(githubDir, 'extensions', 'kaizen')
  const extensionLibDir   = path.join(extensionDir, 'lib')

  // ---- Step 3: Init .kaizen/ (idempotent) ---------------------------------
  console.log('  [1/9] Initializing .kaizen/ directory...')

  fs.mkdirSync(kaizenToolsDir, { recursive: true })
  fs.mkdirSync(kaizenDomainDir, { recursive: true })

  // Copy templates if files don't exist
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

  // ---- Step 4: Init ~/.copilot/kaizen/ (idempotent) -----------------------
  console.log('  [2/9] Initializing global kaizen directory...')

  fs.mkdirSync(globalToolsDir, { recursive: true })
  console.log(`    ✓ ${globalKaizenDir}`)

  // ---- Step 5: Copy hook wrapper scripts ----------------------------------
  console.log('  [3/9] Installing hook wrappers...')

  fs.mkdirSync(hooksInstallDir, { recursive: true })

  const kaizenShDest = path.join(hooksInstallDir, 'kaizen.sh')
  if (!fs.existsSync(kaizenShDest)) {
    fs.copyFileSync(path.join(PACKAGE_ROOT, 'hooks', 'kaizen.sh'), kaizenShDest)
    // chmod +x on Unix
    if (!isWindows) {
      try { fs.chmodSync(kaizenShDest, 0o755) } catch { /* not critical */ }
    }
    console.log('    ✓ .github/hooks/kaizen/kaizen.sh')
  } else {
    console.log('    • .github/hooks/kaizen/kaizen.sh already exists, skipping')
  }

  const kaizenPs1Dest = path.join(hooksInstallDir, 'kaizen.ps1')
  if (!fs.existsSync(kaizenPs1Dest)) {
    fs.copyFileSync(path.join(PACKAGE_ROOT, 'hooks', 'kaizen.ps1'), kaizenPs1Dest)
    console.log('    ✓ .github/hooks/kaizen/kaizen.ps1')
  } else {
    console.log('    • .github/hooks/kaizen/kaizen.ps1 already exists, skipping')
  }

  // ---- Step 6: Write hooks.json (only if not exists) ----------------------
  console.log('  [4/9] Writing hooks configuration...')

  fs.mkdirSync(path.join(githubDir, 'hooks'), { recursive: true })

  if (!fs.existsSync(hooksJsonPath)) {
    fs.copyFileSync(
      path.join(PACKAGE_ROOT, 'hooks.json'),
      hooksJsonPath
    )
    console.log('    ✓ .github/hooks/kaizen.json')
  } else {
    console.log('    • .github/hooks/kaizen.json already exists (not overwritten)')
  }

  // ---- Step 7: Copy extension.mjs + lib/compress.mjs ---------------------
  console.log('  [5/9] Installing Copilot CLI extension...')

  fs.mkdirSync(extensionLibDir, { recursive: true })

  const extensionDest = path.join(extensionDir, 'extension.mjs')
  if (!fs.existsSync(extensionDest)) {
    fs.copyFileSync(path.join(PACKAGE_ROOT, 'extension.mjs'), extensionDest)
    console.log('    ✓ .github/extensions/kaizen/extension.mjs')
  } else {
    console.log('    • .github/extensions/kaizen/extension.mjs already exists, skipping')
  }

  const compressDest = path.join(extensionLibDir, 'compress.mjs')
  if (!fs.existsSync(compressDest)) {
    fs.copyFileSync(path.join(PACKAGE_ROOT, 'lib', 'compress.mjs'), compressDest)
    console.log('    ✓ .github/extensions/kaizen/lib/compress.mjs')
  } else {
    console.log('    • .github/extensions/kaizen/lib/compress.mjs already exists, skipping')
  }

  // ---- Step 8: Open DB (runs initSchema) ----------------------------------
  console.log('  [6/9] Initializing database...')

  const { openDb } = await import('../lib/db.mjs')
  const db = openDb()
  db.close()

  const { getDbPath } = await import('../lib/db.mjs')
  console.log(`    ✓ ${getDbPath()}`)

  // ---- Step 9: Add .gitignore entries (idempotent) ------------------------
  console.log('  [7/9] Updating .gitignore...')

  const gitignorePath = path.join(projectDir, '.gitignore')
  const entriesToAdd = [
    '# copilot-kaizen',
    '.github/hooks/kaizen/',
    '.github/extensions/kaizen/',
  ]

  let gitignoreContent = ''
  try {
    gitignoreContent = fs.readFileSync(gitignorePath, 'utf8')
  } catch {
    // .gitignore doesn't exist
  }

  const linesToAdd = entriesToAdd.filter(line => !gitignoreContent.includes(line))
  if (linesToAdd.length > 0) {
    const suffix = gitignoreContent.endsWith('\n') ? '' : '\n'
    fs.appendFileSync(gitignorePath, suffix + linesToAdd.join('\n') + '\n', 'utf8')
    console.log('    ✓ Added kaizen entries to .gitignore')
  } else {
    console.log('    • .gitignore already has kaizen entries')
  }

  // ---- Step 10: Print summary ---------------------------------------------
  console.log('')
  console.log('  ✅ copilot-kaizen installed successfully!')
  console.log('')
  console.log('  Files created/updated:')
  console.log('    .kaizen/kaizen.md              — Memory index')
  console.log('    .kaizen/general.md             — General conventions')
  console.log('    .kaizen/tools/                 — Per-tool guidance (empty)')
  console.log('    .kaizen/domain/                — Domain knowledge (empty)')
  console.log('    .github/hooks/kaizen.json      — Hook configuration')
  console.log('    .github/hooks/kaizen/          — Hook wrapper scripts')
  console.log('    .github/extensions/kaizen/     — Copilot CLI extension')
  console.log(`    ${getDbPath()}  — SQLite database`)
  console.log('')
  console.log('  Next steps:')
  console.log('    1. Edit .kaizen/general.md with your project conventions')
  console.log('    2. Add tool-specific guidance to .kaizen/tools/<tool>.md')
  console.log('    3. Commit .kaizen/ to your repo (hooks & extensions are gitignored)')
  console.log('    4. Start a Copilot CLI session — kaizen will auto-inject context')
  console.log('')
}
