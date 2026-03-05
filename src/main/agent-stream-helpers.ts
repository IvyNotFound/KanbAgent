/**
 * Build helpers for agent-stream — env, command builders, PS1 script, active tasks.
 * Extracted from agent-stream.ts (T916) to keep file size under 400 lines.
 *
 * @module agent-stream-helpers
 */
import { appendFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { queryLive } from './db'

// ── Constants ─────────────────────────────────────────────────────────────────

export const CLAUDE_CMD_REGEX = /^claude(-[a-z0-9-]+)?$/
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

// ── buildClaudeCmd ────────────────────────────────────────────────────────────

/**
 * Build the bash -lc command string for launching Claude in stream-json mode.
 * System prompt is passed via `"$(cat 'WSL_PATH')"` — the content is read from a temp
 * file inside bash, bypassing Node.js Windows command-line serialization entirely.
 * This avoids the Windows CreateProcess quoting issue where $'...' ANSI-C sequences
 * were corrupted in the Node.js spawn → wsl.exe → bash pipeline (T705).
 *
 * @param opts.claudeCommand   - Claude binary name (validated; defaults to `'claude'`).
 * @param opts.convId          - Existing conversation UUID to resume via `--resume`.
 * @param opts.systemPromptFile - WSL path to temp file with raw system prompt.
 * @param opts.thinkingMode    - `'disabled'` to inject alwaysThinkingEnabled:false.
 * @param opts.permissionMode  - `'auto'` to add `--dangerously-skip-permissions`.
 * @returns Full bash command string for embedding in a launch script (T706).
 */
export function buildClaudeCmd(opts: {
  claudeCommand?: string
  convId?: string
  systemPromptFile?: string
  thinkingMode?: string
  permissionMode?: string
}): string {
  const cmd = (opts.claudeCommand && CLAUDE_CMD_REGEX.test(opts.claudeCommand))
    ? opts.claudeCommand
    : 'claude'

  const parts: string[] = [
    cmd,
    '-p',
    '--verbose',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
  ]

  if (opts.convId) {
    parts.push('--resume', opts.convId)
  }

  if (opts.systemPromptFile) {
    parts.push(`--append-system-prompt "$(cat '${opts.systemPromptFile}')"`)
  }

  if (opts.thinkingMode === 'disabled') {
    parts.push(`--settings '{"alwaysThinkingEnabled":false}'`)
  }

  if (opts.permissionMode === 'auto') {
    parts.push('--dangerously-skip-permissions')
  }

  return parts.join(' ')
}

// ── buildWindowsPS1Script ─────────────────────────────────────────────────────

/**
 * Build a PowerShell script for spawning Claude directly on Windows native (T916).
 *
 * Uses a `List[string]` args array so PowerShell handles quoting/escaping properly,
 * completely bypassing cmd.exe. The system prompt is read from a Windows temp file
 * via `[System.IO.File]::ReadAllText()` and added as a separate list element —
 * PowerShell passes it verbatim to Claude regardless of special characters.
 *
 * @param opts.claudeCommand - Claude binary name (validated against CLAUDE_CMD_REGEX)
 * @param opts.convId        - Existing conversation UUID for `--resume`
 * @param opts.spTempFile    - Windows path to system prompt temp file (no WSL conversion)
 * @param opts.thinkingMode  - `'disabled'` to inject alwaysThinkingEnabled:false
 * @param opts.permissionMode - `'auto'` to add `--dangerously-skip-permissions`
 * @returns PowerShell script content (.ps1)
 */
export function buildWindowsPS1Script(opts: {
  claudeCommand?: string
  convId?: string
  spTempFile?: string
  thinkingMode?: string
  permissionMode?: string
}): string {
  const cmd = (opts.claudeCommand && CLAUDE_CMD_REGEX.test(opts.claudeCommand))
    ? opts.claudeCommand
    : 'claude'

  const lines: string[] = [
    '$ErrorActionPreference = \'Continue\'',
    '$a = [System.Collections.Generic.List[string]]::new()',
    '$a.Add(\'-p\')',
    '$a.Add(\'--verbose\')',
    '$a.Add(\'--input-format\')',
    '$a.Add(\'stream-json\')',
    '$a.Add(\'--output-format\')',
    '$a.Add(\'stream-json\')',
  ]

  if (opts.convId) {
    // convId is a UUID — safe to embed as a PS literal
    lines.push('$a.Add(\'--resume\')')
    lines.push(`$a.Add('${opts.convId}')`)
  }

  if (opts.spTempFile) {
    // Escape single quotes in path (Windows paths use backslash, apostrophe is rare)
    const safePath = opts.spTempFile.replace(/'/g, "''")
    lines.push(`$sp = [System.IO.File]::ReadAllText('${safePath}', [System.Text.Encoding]::UTF8)`)
    lines.push('$a.Add(\'--append-system-prompt\')')
    lines.push('$a.Add($sp)')
  }

  if (opts.thinkingMode === 'disabled') {
    lines.push('$a.Add(\'--settings\')')
    lines.push('$a.Add(\'{"alwaysThinkingEnabled":false}\')')
  }

  if (opts.permissionMode === 'auto') {
    lines.push('$a.Add(\'--dangerously-skip-permissions\')')
  }

  lines.push(`& ${cmd} @a`)

  return lines.join('\n')
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
      WHERE s.statut = 'started' AND s.id != ?
      ORDER BY t.id
    `, [currentSessionId]) as Array<{ id: number }>
    if (!rows.length) return ''
    return 'Active tasks: ' + rows.map(r => '#' + r.id).join(' ')
  } catch {
    return ''
  }
}
