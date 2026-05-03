// lib/synthesize.mjs — Synthesis engine for copilot-kaizen
//
// Called by kaizen.mjs → handleSessionEnd after every non-aborted session.
// Reads accumulated entries from the DB and writes auto-generated blocks into
// .kaizen/*.md files.
//
// INVARIANT: Never touches content outside <!-- kaizen:auto --> markers.
// INVARIANT: Human-authored content is always preserved exactly.
// INVARIANT: Only writes to files that already exist (except tools/*.md and per-category files which may be created).

import fs from 'node:fs'
import path from 'node:path'
import {
  getTopEntriesForSynthesis,
  getToolFailureSummary,
  markEntriesCrystallized,
} from './db.mjs'

// ---------------------------------------------------------------------------
// Auto-block parsing
// ---------------------------------------------------------------------------

const MARKER_OPEN  = '<!-- kaizen:auto -->'
const MARKER_CLOSE = '<!-- /kaizen:auto -->'

/**
 * Parse a markdown file's content into prefix, auto-block content, and suffix.
 * Only ONE `<!-- kaizen:auto -->` block per file is supported.
 * If multiple blocks exist, only the first is updated; the rest remain unchanged.
 *
 * @param {string} content — full file content
 * @returns {{ prefix: string, autoContent: string, suffix: string, noBlock: boolean }}
 *   - prefix: everything before the auto-block open marker
 *   - autoContent: content inside the auto-block (excluding markers)
 *   - suffix: everything after the auto-block close marker
 *   - noBlock: true if no auto-block was found
 */
export function parseAutoBlocks(content) {
  const regex = /<!-- kaizen:auto -->([\s\S]*?)<!-- \/kaizen:auto -->/
  const match = content.match(regex)

  if (!match) {
    return { prefix: content, autoContent: '', suffix: '', noBlock: true }
  }

  const fullMatch = match[0]
  const idx = content.indexOf(fullMatch)

  return {
    prefix: content.slice(0, idx),
    autoContent: match[1],
    suffix: content.slice(idx + fullMatch.length),
    noBlock: false,
  }
}

/**
 * Reconstruct a file with updated auto-block content.
 * Preserves prefix (human-authored content before block) and suffix
 * (human-authored content after block) exactly as they were.
 *
 * @param {string} prefix — content before auto-block
 * @param {string} newAutoContent — new content for inside the auto-block
 * @param {string} suffix — content after auto-block
 * @returns {string} complete file content
 */
export function reconstructFile(prefix, newAutoContent, suffix) {
  return (
    prefix +
    MARKER_OPEN + '\n' +
    newAutoContent + '\n' +
    MARKER_CLOSE +
    suffix
  )
}

// ---------------------------------------------------------------------------
// Content generators
// ---------------------------------------------------------------------------

/**
 * Generate auto-block content for general.md — top mistakes and patterns.
 *
 * @param {Array<{ content: string, hit_count: number, last_seen: string }>} entries
 * @returns {string} markdown content for inside the auto-block
 */
export function generateGeneralAutoContent(entries) {
  if (!entries.length) {
    return '## Auto-generated (last synthesis)\n\n_(no entries yet)_'
  }

  const lines = entries.map(
    e => `- [${e.last_seen.slice(0, 10)}] ${e.content}  (seen ${e.hit_count}x)`
  )

  return '## Auto-generated (last synthesis)\n\n' + lines.join('\n')
}

/**
 * Generate auto-block content for a tool-specific markdown file.
 *
 * @param {string} toolName
 * @param {number} failCount — total failures for this tool
 * @param {Array<{ content: string, hit_count: number, last_seen: string }>} topEntries — all top entries (will be filtered by tool name)
 * @returns {string} markdown content for inside the auto-block
 */
export function generateToolAutoContent(toolName, failCount, topEntries) {
  const toolEntries = topEntries
    .filter(e => e.content.toLowerCase().includes(toolName.toLowerCase()))
    .slice(0, 5)

  const lines = toolEntries.map(
    e => `- [${e.last_seen.slice(0, 10)}] ${e.content}  (seen ${e.hit_count}x)`
  )

  const header = `## Auto-generated — ${toolName} (${failCount} failures)`
  const body = lines.length ? lines.join('\n') : '_(no specific entries)_'

  return header + '\n\n' + body
}

// ---------------------------------------------------------------------------
// Index rebuild
// ---------------------------------------------------------------------------

/**
 * Rebuild the kaizen.md index file by scanning the .kaizen/ directory.
 * Counts list items (lines starting with -) and auto-blocks in each .md file.
 *
 * @param {string} kaizenDir — absolute path to .kaizen/
 */
export function rebuildIndex(kaizenDir) {
  const indexLines = []
  const now = new Date().toISOString().slice(0, 10)

  // Scan top-level .md files (except kaizen.md itself)
  const topFiles = safeReaddir(kaizenDir)
    .filter(f => f.endsWith('.md') && f !== 'kaizen.md')
    .sort()

  for (const file of topFiles) {
    const filePath = path.join(kaizenDir, file)
    const desc = describeFile(filePath)
    indexLines.push(`- ${file} — ${desc}`)
  }

  // Scan tools/ subdirectory
  const toolsDir = path.join(kaizenDir, 'tools')
  const toolFiles = safeReaddir(toolsDir)
    .filter(f => f.endsWith('.md'))
    .sort()

  for (const file of toolFiles) {
    const filePath = path.join(toolsDir, file)
    const desc = describeFile(filePath)
    indexLines.push(`- tools/${file} — ${desc}`)
  }

  // Scan domain/ subdirectory
  const domainDir = path.join(kaizenDir, 'domain')
  const domainFiles = safeReaddir(domainDir)
    .filter(f => f.endsWith('.md'))
    .sort()

  for (const file of domainFiles) {
    const filePath = path.join(domainDir, file)
    const desc = describeFile(filePath)
    indexLines.push(`- domain/${file} — ${desc}`)
  }

  // Write kaizen.md
  const content =
    `# Kaizen Memory Index\n` +
    `<!-- Updated: ${now} -->\n\n` +
    (indexLines.length ? indexLines.join('\n') + '\n' : '_(empty — no files yet)_\n')

  fs.writeFileSync(path.join(kaizenDir, 'kaizen.md'), content, 'utf8')
}

/**
 * Safely read a directory listing. Returns [] on any error.
 * @param {string} dir
 * @returns {string[]}
 */
function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * Describe a .md file for the index: count list entries and auto-blocks.
 * @param {string} filePath
 * @returns {string}
 */
function describeFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const listItems = content.split('\n').filter(l => /^\s*-\s/.test(l)).length
    const hasAutoBlock = content.includes(MARKER_OPEN)
    const parts = []
    if (listItems > 0) parts.push(`${listItems} entries`)
    if (hasAutoBlock) parts.push('auto-block')
    return parts.length ? parts.join(', ') : 'empty'
  } catch {
    return 'unreadable'
  }
}

// ---------------------------------------------------------------------------
// Main synthesis function
// ---------------------------------------------------------------------------

/**
 * Run the full synthesis pipeline:
 *  1. Read top entries from DB
 *  2. Read tool failure summary from DB
 *  3. Write per-category files (mistakes.md, patterns.md, etc.)
 *  4. Write uncategorized entries to general.md
 *  5. Update/create tool-specific auto-blocks
 *  6. Mark high-frequency entries as crystallized
 *  7. Rebuild the kaizen.md index
 *
 * @param {{ db: import('better-sqlite3').Database, projectPath: string, kaizenDir: string, globalKaizenDir: string }} opts
 */
export function synthesize({ db, projectPath, kaizenDir, globalKaizenDir }) {
  // Guard: if .kaizen/ doesn't exist, there's nothing to synthesize into
  if (!fs.existsSync(kaizenDir)) return

  // Step 1: Read data from DB
  let topEntries = []
  let toolFailures = []
  try {
    topEntries = getTopEntriesForSynthesis(db, projectPath, 30)
    toolFailures = getToolFailureSummary(db, projectPath)
  } catch {
    // swallow — synthesize with empty data
  }

  // Step 2: Write per-category files
  updateCategoryFiles(kaizenDir, topEntries)

  // Step 3: Update tool-specific files
  updateToolFiles(kaizenDir, toolFailures, topEntries)

  // Step 4: Mark entries with hit_count >= 5 as crystallized
  const toCrystallize = topEntries
    .filter(e => e.hit_count >= 5)
    .map(e => e.id)

  if (toCrystallize.length > 0) {
    try {
      markEntriesCrystallized(db, toCrystallize)
    } catch {
      // Non-critical
    }
  }

  // Step 5: Rebuild the index
  try {
    rebuildIndex(kaizenDir)
  } catch {
    // Non-critical — index is a convenience
  }
}

// ---------------------------------------------------------------------------
// Internal: file update functions
// ---------------------------------------------------------------------------

// Category → filename mapping (plural forms for readability)
const CATEGORY_FILES = {
  mistake: 'mistakes.md',
  pattern: 'patterns.md',
  convention: 'conventions.md',
  memory: 'memories.md',
  preference: 'preferences.md',
}

/**
 * Write per-category files and update general.md for uncategorized entries.
 * Each known category gets its own file. Entries with unknown categories go to general.md.
 *
 * @param {string} kaizenDir
 * @param {Array<{ content: string, hit_count: number, last_seen: string, category: string }>} topEntries
 */
function updateCategoryFiles(kaizenDir, topEntries) {
  // Group entries by category
  const grouped = {}
  const uncategorized = []

  for (const entry of topEntries) {
    if (CATEGORY_FILES[entry.category]) {
      if (!grouped[entry.category]) grouped[entry.category] = []
      grouped[entry.category].push(entry)
    } else {
      uncategorized.push(entry)
    }
  }

  // Write per-category files
  for (const [category, filename] of Object.entries(CATEGORY_FILES)) {
    const entries = grouped[category]
    if (!entries || entries.length === 0) continue
    try {
      updateAutoBlockFile(kaizenDir, filename, category, entries)
    } catch { /* one file failing must not block others */ }
  }

  // Write uncategorized entries to general.md
  try {
    updateAutoBlockFile(kaizenDir, 'general.md', 'general', uncategorized)
  } catch { /* swallow */ }
}

/**
 * Update or create a .kaizen/<filename> with an auto-block of entries.
 * If file doesn't exist, create it. If it exists, replace only the auto-block.
 *
 * @param {string} kaizenDir
 * @param {string} filename
 * @param {string} heading — used in the auto-block header
 * @param {Array<{ content: string, hit_count: number, last_seen: string }>} entries
 */
function updateAutoBlockFile(kaizenDir, filename, heading, entries) {
  const filePath = path.join(kaizenDir, filename)
  const newAutoContent = generateGeneralAutoContent(entries)

  let content
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    // File doesn't exist — create it with auto-block
    const title = heading.charAt(0).toUpperCase() + heading.slice(1)
    const newContent =
      `# ${title}\n\n` +
      MARKER_OPEN + '\n' +
      newAutoContent + '\n' +
      MARKER_CLOSE + '\n'
    fs.writeFileSync(filePath, newContent, 'utf8')
    return
  }

  // File exists — update auto-block
  const parsed = parseAutoBlocks(content)

  let newContent
  if (parsed.noBlock) {
    newContent =
      content.trimEnd() + '\n\n' +
      MARKER_OPEN + '\n' +
      newAutoContent + '\n' +
      MARKER_CLOSE + '\n'
  } else {
    newContent = reconstructFile(parsed.prefix, newAutoContent, parsed.suffix)
  }

  fs.writeFileSync(filePath, newContent, 'utf8')
}

/**
 * For each tool that has failures, update or create .kaizen/tools/<tool>.md
 * with an auto-block containing tool-specific insights.
 *
 * @param {string} kaizenDir
 * @param {Array<{ tool_name: string, fail_count: number }>} toolFailures
 * @param {Array<{ content: string, hit_count: number, last_seen: string }>} topEntries
 */
function updateToolFiles(kaizenDir, toolFailures, topEntries) {
  if (!toolFailures.length) return

  const toolsDir = path.join(kaizenDir, 'tools')

  for (const { tool_name, fail_count } of toolFailures) {
    try {
      // Sanitize tool name for filesystem
      const safeName = tool_name.replace(/[^a-zA-Z0-9_-]/g, '_')
      const toolFilePath = path.join(toolsDir, safeName + '.md')

      // Check if the tool file exists
      let content
      try {
        content = fs.readFileSync(toolFilePath, 'utf8')
      } catch {
        // File doesn't exist — only create if toolsDir exists
        if (!fs.existsSync(toolsDir)) continue

        // Create a new tool file with auto-block
        const newAutoContent = generateToolAutoContent(tool_name, fail_count, topEntries)
        const newContent =
          `# ${tool_name}\n\n` +
          `<!-- Human-authored guidance goes above the auto block -->\n\n` +
          MARKER_OPEN + '\n' +
          newAutoContent + '\n' +
          MARKER_CLOSE + '\n'

        fs.writeFileSync(toolFilePath, newContent, 'utf8')
        continue
      }

      // File exists — update auto-block
      const newAutoContent = generateToolAutoContent(tool_name, fail_count, topEntries)
      const parsed = parseAutoBlocks(content)

      let newContent
      if (parsed.noBlock) {
        // Append auto-block
        newContent =
          content.trimEnd() + '\n\n' +
          MARKER_OPEN + '\n' +
          newAutoContent + '\n' +
          MARKER_CLOSE + '\n'
      } else {
        newContent = reconstructFile(parsed.prefix, newAutoContent, parsed.suffix)
      }

      fs.writeFileSync(toolFilePath, newContent, 'utf8')
    } catch {
      // swallow silently — one tool failing must not block others
    }
  }
}
