#!/usr/bin/env node
/**
 * db-server-stop.js — Gracefully stop the KanbAgent DB daemon.
 *
 * Reads the PID file written by db-server.js and sends SIGTERM.
 * Waits up to 3s for the process to exit.
 *
 * Usage:
 *   node scripts/db-server-stop.js [--db <path>]
 *   DB_SERVER_PATH=<path> node scripts/db-server-stop.js
 */

const os = require('os')
const path = require('path')
const fs = require('fs')
const { getPort } = require('./db-port')

const args = process.argv.slice(2)
function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : null
}

const cwd = process.cwd()
const normalizedCwd = cwd.replace(/\\/g, '/')
const worktreeMarker = '.claude/worktrees'
const isInWorktree = normalizedCwd.includes(worktreeMarker)
const mainRepoPath = isInWorktree
  ? cwd.slice(0, normalizedCwd.indexOf(worktreeMarker)).replace(/[\\/]+$/, '')
  : cwd

const dbPath = path.resolve(
  getArg('--db') || process.env['DB_SERVER_PATH'] || path.join(mainRepoPath, '.claude/project.db')
)

const portArg = getArg('--port')
const port = portArg ? parseInt(portArg, 10) : (
  parseInt(process.env['DB_SERVER_PORT'] || '0', 10) || getPort(dbPath)
)

const pidFile = path.join(os.tmpdir(), `kanbagent-db-${port}.pid`)

let pid
try {
  pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10)
} catch {
  console.log(`[db-server-stop] No PID file at ${pidFile} — daemon may not be running`)
  process.exit(0)
}

if (!pid || isNaN(pid)) {
  console.error('[db-server-stop] Invalid PID in PID file')
  process.exit(1)
}

try {
  process.kill(pid, 0) // Probe: throws if process is dead
} catch {
  console.log(`[db-server-stop] Process ${pid} is no longer running — cleaning up PID file`)
  try { fs.unlinkSync(pidFile) } catch {}
  process.exit(0)
}

console.log(`[db-server-stop] Sending SIGTERM to PID ${pid} (port ${port})`)
process.kill(pid, 'SIGTERM')

// Wait for the process to exit (max 3s)
const deadline = Date.now() + 3000
const interval = setInterval(() => {
  let alive = false
  try { process.kill(pid, 0); alive = true } catch {}
  if (!alive) {
    clearInterval(interval)
    console.log(`[db-server-stop] Daemon stopped (PID ${pid})`)
    process.exit(0)
  }
  if (Date.now() > deadline) {
    clearInterval(interval)
    console.error(`[db-server-stop] Daemon did not stop within 3s — may need manual kill`)
    process.exit(1)
  }
}, 100)
