// lib/project.mjs — Project path utilities for copilot-kaizen
// All paths are absolute. Never relative. Never empty.

import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

/**
 * Resolve the git repository root for a given working directory.
 * Falls back to cwd itself if not inside a git repo.
 * @param {string} cwd — absolute path to the working directory
 * @returns {string} absolute path to the project root
 */
export function getProjectRoot(cwd) {
  try {
    return path.normalize(execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim())
  } catch {
    return path.normalize(cwd)
  }
}

/**
 * Return the .kaizen directory inside a project root.
 * @param {string} projectRoot — absolute path
 * @returns {string} absolute path to <projectRoot>/.kaizen
 */
export function getKaizenDir(projectRoot) {
  return path.join(projectRoot, '.kaizen')
}

/**
 * Return the global kaizen config directory (~/.copilot/kaizen/).
 * @returns {string} absolute path
 */
export function getGlobalKaizenDir() {
  return path.join(os.homedir(), '.copilot', 'kaizen')
}

/**
 * Derive a short hash key from cwd for temp-file naming.
 * Uses MD5 truncated to 8 hex chars — collision-safe for a handful of projects.
 * @param {string} cwd — absolute path
 * @returns {string} 8-char hex string
 */
function cwdKey(cwd) {
  return crypto.createHash('md5').update(cwd).digest('hex').slice(0, 8)
}

/**
 * Return the OS-appropriate tmp file path for storing the current session ID.
 * Windows: %TEMP%\kaizen_session_<key>
 * Unix:    /tmp/kaizen_session_<key>
 * @param {string} cwd — absolute path
 * @returns {string} absolute path to the session tmp file
 */
export function getSessionTmpFile(cwd) {
  const key = cwdKey(cwd)
  // os.tmpdir() returns the right thing on all platforms
  return path.join(os.tmpdir(), `kaizen_session_${key}`)
}

/**
 * Return the OS-appropriate tmp file path for storing which tools have been
 * injected this session (prevents double-injection).
 * @param {string} cwd — absolute path
 * @returns {string} absolute path to the injected-tools tmp file
 */
export function getInjectedTmpFile(cwd) {
  const key = cwdKey(cwd)
  return path.join(os.tmpdir(), `kaizen_injected_${key}`)
}
