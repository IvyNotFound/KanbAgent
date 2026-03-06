/**
 * Build helpers for agent-stream — env, active tasks injection.
 * Extracted from agent-stream.ts (T916) to keep file size under 400 lines.
 *
 * buildClaudeCmd, buildWindowsPS1Script, CLAUDE_CMD_REGEX moved to adapters/claude.ts (T1012).
 * Re-exported here for backward compatibility with existing imports and spec files.
 *
 * @module agent-stream-helpers
 */
import { appendFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { queryLive } from './db'

// Re-exports from adapters/claude — backward compat (T1012)
export { CLAUDE_CMD_REGEX, buildClaudeCmd, buildWindowsPS1Script } from './adapters/claude'

// ── Constants ─────────────────────────────────────────────────────────────────

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_STDERR_BUFFER_SIZE = 10_000

// ── Debug logging ─────────────────────────────────────────────────────────────

/**
 * Append a debug message to the agent-stream log file.
 * Writes to app.getPath('logs')/agent-stream-debug.log — visible in packaged app
 * without DevTools. Errors are silently swallowed so logging never crashes the app.
 */
export function logDebug(msg: string): void {
  try {
    const logPath = join(app.getPath('logs'), 'agent-stream-debug.log')
    appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* logging must never crash the app */ }
}

// ── buildEnv ──────────────────────────────────────────────────────────────────

/**
 * Build minimal env for the spawned process.
 * Forwards Windows system vars required by wsl.exe RPC.
 * Sets TERM=dumb + NO_COLOR=1 to suppress any ANSI from bash startup.
 * Note: no ANTHROPIC_API_KEY — auth is handled via OAuth tokens stored in ~/.claude/ (WSL).
 */
export function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {
    TERM: 'dumb',
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    NO_COLOR: '1',
  }
  const forwardVars = [
    'SystemRoot', 'SYSTEMROOT',
    'SYSTEMDRIVE',
    'LOCALAPPDATA', 'APPDATA',
    'USERPROFILE',
    'USERNAME',
    'COMPUTERNAME',
    'TEMP', 'TMP',
    'WINDIR',
    'WSLENV',
    'WSL_DISTRO_NAME',
    'PATH',
    'HOME',
  ]
  for (const v of forwardVars) {
    if (process.env[v]) env[v] = process.env[v]!
  }
  if (!env.HOME && process.env.USERPROFILE) env.HOME = process.env.USERPROFILE
  return env
}

// ── getActiveTasksLine ────────────────────────────────────────────────────────

/**
 * Query active task IDs from other in-progress sessions (DB-first, no JSONL).
 * Returns a compact string like "Active tasks: #42 #67" or "" if none.
 *
 * @param dbPath - Registered project DB path
 * @param currentSessionId - The session ID of the agent being spawned (excluded)
 */
export async function getActiveTasksLine(dbPath: string, currentSessionId: number): Promise<string> {
  try {
    const rows = await queryLive(dbPath, `
      SELECT t.id
      FROM sessions s
      JOIN tasks t ON t.session_id = s.id
      WHERE s.status = 'started' AND s.id != ?
      ORDER BY t.id
    `, [currentSessionId]) as Array<{ id: number }>
    if (!rows.length) return ''
    return 'Active tasks: ' + rows.map(r => '#' + r.id).join(' ')
  } catch {
    return ''
  }
}
