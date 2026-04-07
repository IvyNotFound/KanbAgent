/**
 * db-daemon.ts — Electron-side lifecycle manager for the DB HTTP daemon.
 *
 * The DB daemon (scripts/db-server.js) is a persistent Node.js HTTP server
 * that replaces per-call sqlite3.exe spawns from agent scripts.
 * Each project DB gets its own daemon instance on a deterministic port.
 *
 * Lifecycle:
 *   - startDbDaemon(dbPath) — called when a project is opened
 *   - stopAllDbDaemons()    — called when the app window closes
 *
 * The daemon is intentionally a detached child process so it survives
 * renderer reloads; we track the PID ourselves and kill on app quit.
 *
 * @module db-daemon
 */

import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import { createHash } from 'crypto'

// ── Port derivation (mirrors scripts/db-port.js) ─────────────────────────────
const BASE_PORT = 27184

function getPort(dbPath: string): number {
  const hash = createHash('sha1').update(dbPath).digest('hex')
  return BASE_PORT + (parseInt(hash.slice(0, 4), 16) % 10000)
}

// ── Active daemon registry ────────────────────────────────────────────────────
const activeDaemons = new Map<number, ChildProcess>()

/**
 * Checks if the daemon for the given port is responding.
 */
async function isDaemonRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(500),
    })
    if (!res.ok) return false
    const data = await res.json() as { status?: string }
    return data.status === 'ok'
  } catch {
    return false
  }
}

/**
 * Starts the DB daemon for the given project database path.
 * No-ops if a daemon is already running for that port.
 *
 * Called from ipc-project.ts when registerDbPath() is invoked.
 *
 * @param dbPath - Absolute path to project.db
 */
export async function startDbDaemon(dbPath: string): Promise<void> {
  const port = getPort(dbPath)

  if (await isDaemonRunning(port)) return // already up

  const serverScript = join(__dirname, '../../scripts/db-server.js')
  if (!existsSync(serverScript)) {
    console.warn('[db-daemon] db-server.js not found at', serverScript, '— skipping daemon start')
    return
  }

  const child = spawn(process.execPath, [serverScript, '--db', dbPath], {
    detached: false, // Electron controls lifetime
    stdio: 'ignore',
    env: { ...process.env, DB_SERVER_PATH: dbPath },
  })

  child.on('error', (err) => {
    console.warn(`[db-daemon] Failed to start daemon for port ${port}:`, err.message)
    activeDaemons.delete(port)
  })

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[db-daemon] Daemon (port ${port}) exited with code ${code}`)
    }
    activeDaemons.delete(port)
  })

  activeDaemons.set(port, child)
  console.log(`[db-daemon] Started daemon for port ${port} (db: ${dbPath})`)
}

/**
 * Stops all running DB daemons. Called on app 'window-all-closed'.
 */
export function stopAllDbDaemons(): void {
  for (const [port, child] of activeDaemons.entries()) {
    try {
      child.kill('SIGTERM')
      console.log(`[db-daemon] Sent SIGTERM to daemon on port ${port}`)
    } catch (err) {
      console.warn(`[db-daemon] Failed to stop daemon on port ${port}:`, err)
    }
  }
  activeDaemons.clear()
}
