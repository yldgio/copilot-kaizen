// lib/inject.mjs — Context assembly for copilot-kaizen injection
//
// Reads .kaizen/ markdown files from the project and/or global kaizen dir
// and assembles them into strings suitable for additionalContext.
//
// Used by:
//   extension.mjs → onSessionStart  (assembleSessionContext)
//   extension.mjs → onPreToolUse    (assembleToolContext)
//
// INVARIANT: Every read is wrapped in try/catch. Missing files are never errors.
// INVARIANT: assembleToolContext returns null (not '') when there's nothing to inject.

import fs from 'node:fs'
import path from 'node:path'
import { compressText } from './compress.mjs'

// ---------------------------------------------------------------------------
// Session-level context (full kaizen index + general)
// ---------------------------------------------------------------------------

/**
 * Assemble session-start context from the project's .kaizen/ directory.
 *
 * Resolution order:
 *   1. <projectRoot>/.kaizen/kaizen.md  (index)
 *   2. <projectRoot>/.kaizen/general.md (conventions)
 *   3. If neither exists: <globalKaizenDir>/kaizen.md (global fallback)
 *
 * @param {{ projectRoot: string, globalKaizenDir: string }} opts
 * @returns {string} assembled markdown or '' if nothing found
 */
export function assembleSessionContext({ projectRoot, globalKaizenDir }) {
  const parts = []

  // Project-local files first
  const kaizenMd = path.join(projectRoot, '.kaizen', 'kaizen.md')
  const generalMd = path.join(projectRoot, '.kaizen', 'general.md')

  try {
    if (fs.existsSync(kaizenMd)) {
      parts.push(fs.readFileSync(kaizenMd, 'utf8'))
    }
  } catch {
    // Missing or unreadable — skip
  }

  try {
    if (fs.existsSync(generalMd)) {
      parts.push(fs.readFileSync(generalMd, 'utf8'))
    }
  } catch {
    // Missing or unreadable — skip
  }

  // Global fallback: only if no project-local files found
  if (parts.length === 0) {
    const globalKaizenMd = path.join(globalKaizenDir, 'kaizen.md')
    try {
      if (fs.existsSync(globalKaizenMd)) {
        parts.push(fs.readFileSync(globalKaizenMd, 'utf8'))
      }
    } catch {
      // Missing — skip
    }
  }

  if (parts.length === 0) return ''

  const assembled = parts.join('\n\n---\n\n')
  return compressText(assembled, 8000)
}

// ---------------------------------------------------------------------------
// Tool-level context (per-tool markdown files)
// ---------------------------------------------------------------------------

/**
 * Assemble tool-specific context for a given tool name.
 *
 * Reads:
 *   1. <projectRoot>/.kaizen/tools/<toolName>.md  (project-specific tool guidance)
 *   2. <globalKaizenDir>/tools/<toolName>.md      (global tool guidance)
 *
 * Both are included if they exist (project + global combined).
 *
 * @param {{ toolName: string, projectRoot: string, globalKaizenDir: string }} opts
 * @returns {string | null} assembled markdown or null if nothing found
 */
export function assembleToolContext({ toolName, projectRoot, globalKaizenDir }) {
  const parts = []

  // Sanitize toolName to prevent path traversal
  const safeName = path.basename(toolName)

  // Project-local tool file
  const projectToolMd = path.join(projectRoot, '.kaizen', 'tools', safeName + '.md')
  try {
    if (fs.existsSync(projectToolMd)) {
      parts.push(fs.readFileSync(projectToolMd, 'utf8'))
    }
  } catch {
    // Missing or unreadable — skip
  }

  // Global tool file
  const globalToolMd = path.join(globalKaizenDir, 'tools', safeName + '.md')
  try {
    if (fs.existsSync(globalToolMd)) {
      parts.push(fs.readFileSync(globalToolMd, 'utf8'))
    }
  } catch {
    // Missing or unreadable — skip
  }

  // INVARIANT: return null (not '') when there's nothing to inject
  if (parts.length === 0) return null

  const assembled = parts.join('\n\n---\n\n')
  return compressText(assembled, 4000)
}
