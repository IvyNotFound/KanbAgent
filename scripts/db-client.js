#!/usr/bin/env node
/**
 * db-client.js — HTTP client helper for the KanbAgent DB daemon.
 *
 * Provides:
 *   - queryDaemon(port, endpoint, body)  → result object | null on failure
 *   - ensureDaemon(dbPath, timeoutMs)    → boolean (for Electron to pre-start daemon)
 *   - getDbPath(cwd)                     → resolved .claude/project.db path
 *
 * The design decision is: NO auto-start in dbq/dbw scripts.
 * The daemon is started by Electron at boot (src/main/db-daemon.ts).
 * ensureDaemon() is exported for Electron's use, not for scripts.
 *
 * Scripts (dbq, dbw, dbstart) call queryDaemon() only.
 * If the daemon is not running, queryDaemon() returns null → scripts fall back to CLI.
 */

const { spawn } = require('child_process')
const path = require('path')
const { getPort } = require('./db-port')

/**
 * Resolves the project.db path from the given working directory.
 * Handles worktree layouts (detects .claude/worktrees marker).
 *
 * @param {string} cwd - Working directory to resolve from
 * @returns {string} Absolute path to .claude/project.db
 */
function getDbPath(cwd) {
  const normalizedCwd = cwd.replace(/\\/g, '/')
  const worktreeMarker = '.claude/worktrees'
  const isInWorktree = normalizedCwd.includes(worktreeMarker)
  const mainRepoPath = isInWorktree
    ? cwd.slice(0, normalizedCwd.indexOf(worktreeMarker)).replace(/[\\/]+$/, '')
    : cwd
  return path.resolve(mainRepoPath, '.claude/project.db')
}

/**
 * Sends a request to the DB daemon.
 * Returns null (not throws) on any failure — callers use this as the fallback signal.
 *
 * @param {number} port - Daemon port (from getPort(dbPath))
 * @param {string} endpoint - e.g. '/query', '/write', '/exec', '/health'
 * @param {object} body - JSON body for POST requests, or null for GET
 * @param {number} [timeoutMs=2000] - Request timeout
 * @returns {Promise<object|null>} Parsed JSON response, or null on failure
 */
async function queryDaemon(port, endpoint, body, timeoutMs = 2000) {
  try {
    const method = body === null ? 'GET' : 'POST'
    const init = {
      method,
      signal: AbortSignal.timeout(timeoutMs),
    }
    if (body !== null) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body)
    }
    const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, init)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Checks if the daemon is currently running for the given port.
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function isDaemonRunning(port) {
  const result = await queryDaemon(port, '/health', null, 500)
  return result !== null && result.status === 'ok'
}

/**
 * Starts the DB daemon if it is not already running.
 * Waits up to timeoutMs for the daemon to become ready.
 *
 * Intended for use by Electron (src/main/db-daemon.ts), NOT by dbq/dbw scripts.
 *
 * @param {string} dbPath - Absolute path to project.db
 * @param {number} [timeoutMs=3000] - Timeout before giving up
 * @returns {Promise<boolean>} true if daemon is ready, false on timeout
 */
async function ensureDaemon(dbPath, timeoutMs = 3000) {
  const port = getPort(dbPath)

  // Already running?
  if (await isDaemonRunning(port)) return true

  // Spawn the daemon
  const serverScript = path.resolve(__dirname, 'db-server.js')
  const child = spawn(process.execPath, [serverScript, '--db', dbPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, DB_SERVER_PATH: dbPath },
  })
  child.unref()

  // Poll until ready or timeout
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100))
    if (await isDaemonRunning(port)) return true
  }
  return false
}

module.exports = { getDbPath, getPort, queryDaemon, isDaemonRunning, ensureDaemon }
