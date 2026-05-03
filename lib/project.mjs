// lib/project.mjs — Project path utilities for copilot-kaizen
// All paths are absolute. Never relative. Never empty.

import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

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
