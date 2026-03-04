/**
 * Agent stream management for agent-viewer.
 *
 * Implements ADR-009: child_process.spawn + stdio:pipe for Claude Code agent sessions.
 * Replaces the node-pty approach for stream-json sessions — avoids ANSI injection,
 * line wrapping, and enables true multi-turn via stdin JSONL without respawning.
 *
 * Architecture:
 * - spawn('wsl.exe', [..., 'bash', '-l', scriptPath], { stdio: 'pipe' })
 * - readline on stdout → JSONL events, 0 ANSI corruption
 * - proc.stdin.write() for multi-turn messages (no respawn)
 * - convId extracted from system:init event (no banner scanning needed)
 *
 * @module agent-stream
 */
import { ipcMain, webContents, app } from 'electron'
import { spawn, type ChildProcess, execFile } from 'child_process'
import { createInterface } from 'readline'
import { appendFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { toWslPath } from './utils/wsl'
import { queryLive, assertDbPathAllowed } from './db'

// ── Debug logging ─────────────────────────────────────────────────────────────

/**
 * Append a debug message to the agent-stream log file.
 * Writes to app.getPath('logs')/agent-stream-debug.log — visible in packaged app
 * without DevTools. Errors are silently swallowed so logging never crashes the app.
 */
function logDebug(msg: string): void {
  try {
    const logPath = join(app.getPath('logs'), 'agent-stream-debug.log')
    appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* logging must never crash the app */ }
}

// ── Process registry ──────────────────────────────────────────────────────────

const agents = new Map<string, ChildProcess>()

// Track which agent IDs belong to each WebContents (for auto-cleanup on renderer destroy)
const webContentsAgents = new Map<number, Set<string>>()

let nextAgentId = 1

// ── Validation ────────────────────────────────────────────────────────────────

const CLAUDE_CMD_REGEX = /^claude(-[a-z0-9-]+)?$/
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build minimal env for the spawned process.
 * Forwards Windows system vars required by wsl.exe RPC.
 * Sets TERM=dumb + NO_COLOR=1 to suppress any ANSI from bash startup.
 * Note: no ANTHROPIC_API_KEY — auth is handled via OAuth tokens stored in ~/.claude/ (WSL).
 */
function buildEnv(): Record<string, string> {
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

/**
 * Build the bash -lc command string for launching Claude in stream-json mode.
 * System prompt is passed via `"$(cat 'WSL_PATH')"` — the content is read from a temp
 * file inside bash, bypassing Node.js Windows command-line serialization entirely.
 * This avoids the Windows CreateProcess quoting issue where $'...' ANSI-C sequences
 * were corrupted in the Node.js spawn → wsl.exe → bash pipeline (T705).
 *
 * @param opts - Launch options.
 * @param opts.claudeCommand - Claude binary name (validated against `CLAUDE_CMD_REGEX`; defaults to `'claude'`).
 * @param opts.convId - Existing conversation UUID to resume via `--resume`.
 * @param opts.systemPromptFile - WSL path to a temp file containing the raw system prompt.
 *   Path must not contain single quotes (e.g. `/mnt/c/Users/Cover/AppData/Local/Temp/claude-sp-1.txt`).
 * @param opts.thinkingMode - Set to `'disabled'` to inject `--settings '{"alwaysThinkingEnabled":false}'`.
 * @param opts.permissionMode - Set to `'auto'` to add `--dangerously-skip-permissions`.
 * @returns The full bash command string to embed in a launch script executed as `bash -l script.sh` (T706).
 *   Do NOT pass this string directly to `bash -lc` via wsl.exe — write it to a temp file first
 *   so wsl.exe outer-shell expansion cannot evaluate `$(cat ...)` before bash sees it.
 */
function buildClaudeCmd(opts: {
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
    // Read system prompt from temp file inside bash — bypasses Windows command-line
    // serialization entirely. The WSL path contains no apostrophes so single-quote
    // wrapping of the path is safe. Content is passed verbatim to Claude.
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

// ── Active tasks context injection (T772) ─────────────────────────────────────

/**
 * Query active task IDs from other in-progress sessions (DB-first, no JSONL).
 * Returns a compact string like "Active tasks: #42 #67" or "" if none.
 *
 * Uses `tasks.session_id` JOIN to find tasks linked to started sessions
 * (excluding the current session). Ultra-compact format to minimize token cost.
 *
 * @param dbPath - Registered project DB path
 * @param currentSessionId - The session ID of the agent being spawned (excluded)
 */
async function getActiveTasksLine(dbPath: string, currentSessionId: number): Promise<string> {
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

// ── Kill helpers ──────────────────────────────────────────────────────────────

/**
 * Kill a single agent process and clean up registry.
 * On Windows, also runs taskkill /F /T to terminate the full wsl.exe process tree.
 */
function killAgent(id: string): void {
  const proc = agents.get(id)
  if (!proc) return
  const pid = proc.pid
  try { proc.kill() } catch { /* already dead */ }
  agents.delete(id)

  // On Windows, proc.kill() may not terminate wsl.exe child processes (bash, claude).
  // Force-kill the full process tree via taskkill — non-blocking, errors ignored.
  if (process.platform === 'win32' && pid) {
    execFile('taskkill', ['/F', '/PID', String(pid), '/T'], () => { /* ignore */ })
  }
}

/** Kill all active agent processes. Called on app quit. */
function killAllAgents(): void {
  for (const id of [...agents.keys()]) {
    killAgent(id)
  }
  webContentsAgents.clear()
}

// ── Handler registration ──────────────────────────────────────────────────────

/**
 * Registers all agent-stream IPC handlers.
 * Must be called once during app initialization (from main/index.ts).
 *
 * Handlers:
 * - `agent:create` → spawn child_process, return id, emit agent:stream:<id> events
 * - `agent:send`   → write JSONL message to process stdin (multi-turn)
 * - `agent:kill`   → kill the process
 *
 * Events emitted to renderer:
 * - `agent:stream:<id>` — parsed JSONL event object (StreamEvent)
 * - `agent:stream:<id>` `{ type: 'error:spawn', error }` — wsl.exe failed to start (ENOENT, EACCES…)
 * - `agent:stream:<id>` `{ type: 'error:exit', error, stderr? }` — process exited with non-zero code
 *   before emitting any JSONL event; stderr contains the buffered process output when available (T697)
 * - `agent:convId:<id>` — session_id extracted from system:init event
 * - `agent:exit:<id>`   — exitCode (number | null) when process closes
 */
export function registerAgentStreamHandlers(): void {
  app.on('before-quit', killAllAgents)

  ipcMain.handle('agent:create', async (event, opts: {
    cols?: number
    rows?: number
    projectPath?: string
    wslDistro?: string
    systemPrompt?: string
    thinkingMode?: string
    claudeCommand?: string
    convId?: string
    permissionMode?: string
    dbPath?: string
    sessionId?: number
  } = {}) => {
    // Validate inputs
    if (opts.claudeCommand && !CLAUDE_CMD_REGEX.test(opts.claudeCommand)) {
      throw new Error('Invalid claudeCommand: ' + opts.claudeCommand)
    }
    const validConvId = opts.convId && UUID_REGEX.test(opts.convId) ? opts.convId : undefined

    const id = String(nextAgentId++)
    const wcId = event.sender.id

    // Register cleanup for this webContents on first agent creation
    if (!webContentsAgents.has(wcId)) {
      webContentsAgents.set(wcId, new Set())
      // When the renderer is destroyed (window close, crash, reload), kill its agents
      event.sender.once('destroyed', () => {
        const ids = webContentsAgents.get(wcId)
        if (ids) {
          for (const aid of ids) killAgent(aid)
          webContentsAgents.delete(wcId)
        }
      })
    }
    webContentsAgents.get(wcId)!.add(id)

    // Build wsl.exe args
    const wslArgs: string[] = []
    if (opts.wslDistro) wslArgs.push('-d', opts.wslDistro)
    if (opts.projectPath) wslArgs.push('--cd', toWslPath(opts.projectPath))

    // T772: Inject active tasks context into system prompt (DB-first, ultra-compact).
    // Appends "Active tasks: #N #M" if other agents are in-progress sessions.
    // Zero tokens injected when no other agents are active.
    let effectiveSystemPrompt = opts.systemPrompt ?? ''
    if (opts.dbPath && Number.isInteger(opts.sessionId) && opts.sessionId! > 0) {
      try {
        assertDbPathAllowed(opts.dbPath)
        const activeLine = await getActiveTasksLine(opts.dbPath, opts.sessionId!)
        if (activeLine) {
          effectiveSystemPrompt = effectiveSystemPrompt
            ? effectiveSystemPrompt + '\n\n' + activeLine
            : activeLine
        }
      } catch { /* never block spawn on context injection failure */ }
    }

    // Write system prompt to a Windows temp file so bash reads it directly — avoids the
    // Windows CreateProcess command-line serialization issue with $'...' ANSI-C quoting (T705).
    let spTempFile: string | undefined
    if (effectiveSystemPrompt) {
      spTempFile = join(tmpdir(), `claude-sp-${id}.txt`)
      writeFileSync(spTempFile, effectiveSystemPrompt, 'utf-8')
    }

    const claudeCmd = buildClaudeCmd({
      claudeCommand: opts.claudeCommand,
      convId: validConvId,
      systemPromptFile: spTempFile ? toWslPath(spTempFile) : undefined,
      thinkingMode: opts.thinkingMode,
      permissionMode: opts.permissionMode,
    })

    // Write bash launch script to avoid wsl.exe outer-shell expansion of $(cat ...) (T706).
    // When wsl.exe receives "bash -lc "cmd"", an intermediate shell evaluates $(cat file)
    // before bash sees it — the system prompt content becomes the bash script, causing
    // parse errors at line N (e.g. "syntax error near unexpected token '('").
    // Solution: write the full command into a .sh file and pass only a plain path to wsl.exe.
    const scriptTempFile = join(tmpdir(), `claude-start-${id}.sh`)
    writeFileSync(scriptTempFile, `#!/bin/bash\nexec ${claudeCmd}\n`, 'utf-8')
    const scriptWslPath = toWslPath(scriptTempFile)

    // Resolve wsl.exe via absolute path to avoid ENOENT in packaged app where
    // C:\Windows\System32 may be absent from the spawned process PATH (Fix T692).
    const wslExe = process.env.SystemRoot
      ? join(process.env.SystemRoot, 'System32', 'wsl.exe')
      : 'C:\\Windows\\System32\\wsl.exe'

    logDebug(`spawn attempt: exe=${wslExe} script=${scriptWslPath} args=${JSON.stringify([...wslArgs, '--', 'bash', '-l', scriptWslPath])}`)
    console.log('[agent-stream] spawn', wslExe, wslArgs)
    const proc = spawn(wslExe, [...wslArgs, '--', 'bash', '-l', scriptWslPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildEnv(),
    })

    agents.set(id, proc)

    let eventsReceived = 0
    let stderrBuffer = ''

    // Buffer stderr — do NOT emit line-by-line to avoid spamming the renderer (T697).
    // Flushed only on abnormal exit (exitCode !== 0) as context for error:exit.
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString()
    })

    // readline on stdout → clean JSONL lines, 0 ANSI corruption
    const rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      const clean = line.trim()
      if (!clean) return
      if (eventsReceived === 0) logDebug(`first stdout line (raw): ${line.slice(0, 200)}`)
      try {
        const parsed: Record<string, unknown> = JSON.parse(clean)
        eventsReceived++

        // Extract convId from system:init event — no banner scanning needed
        if (
          parsed.type === 'system' &&
          parsed.subtype === 'init' &&
          typeof parsed.session_id === 'string'
        ) {
          const wc = webContents.fromId(wcId)
          if (wc && !wc.isDestroyed()) {
            wc.send(`agent:convId:${id}`, parsed.session_id)
          }
        }

        // Use webContents.fromId to avoid stale sender closure (same fix as terminal.ts T633)
        const wc = webContents.fromId(wcId)
        if (!wc || wc.isDestroyed()) {
          killAgent(id)
          return
        }
        wc.send(`agent:stream:${id}`, parsed)
      } catch {
        // Non-JSON line (bash startup, profile output, etc.) — skip silently
      }
    })

    proc.on('error', (err) => {
      logDebug(`spawn error id=${id}: ${err.message} (code=${(err as NodeJS.ErrnoException).code})`)
      console.error(`[agent-stream] spawn error id=${id}:`, err)
      rl.close()
      agents.delete(id)
      webContentsAgents.get(wcId)?.delete(id)
      // Send error event to renderer for visibility without DevTools (Fix T692)
      const wc = webContents.fromId(wcId)
      if (wc && !wc.isDestroyed()) {
        wc.send(`agent:stream:${id}`, { type: 'error:spawn', error: err.message })
      }
    })

    proc.on('close', (exitCode) => {
      rl.close()
      agents.delete(id)
      webContentsAgents.get(wcId)?.delete(id)
      if (spTempFile) try { unlinkSync(spTempFile) } catch { /* cleanup best-effort */ }
      try { unlinkSync(scriptTempFile) } catch { /* cleanup best-effort */ }

      logDebug(`close id=${id}: exitCode=${exitCode} eventsReceived=${eventsReceived} stderr=${stderrBuffer.slice(0, 200)}`)

      // Signal exit without output — covers exitCode=0 (silent claude failure) and exitCode≠0.
      // Replaces the previous exitCode!==0 check: if claude exits 0 but emits no JSONL,
      // the renderer would see nothing (T704). Include buffered stderr as diagnostic context (T697).
      if (eventsReceived === 0) {
        const wc = webContents.fromId(wcId)
        if (wc && !wc.isDestroyed()) {
          const msg = exitCode !== 0
            ? `Process exited with code ${exitCode}`
            : `Process exited without producing any output (code ${exitCode})`
          wc.send(`agent:stream:${id}`, {
            type: 'error:exit',
            error: msg,
            stderr: stderrBuffer.trim() || undefined,
          })
        }
      }
      stderrBuffer = ''

      const wc = webContents.fromId(wcId)
      if (wc && !wc.isDestroyed()) {
        wc.send(`agent:exit:${id}`, exitCode)
      }
    })

    return id
  })

  ipcMain.handle('agent:send', (_event, id: string, text: string) => {
    if (typeof id !== 'string' || typeof text !== 'string') {
      throw new Error('agent:send requires id: string and text: string')
    }
    const proc = agents.get(id)
    if (!proc || !proc.stdin) throw new Error(`No active agent process for id=${id}`)
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
    }) + '\n'
    proc.stdin.write(msg)
  })

  ipcMain.handle('agent:kill', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('agent:kill requires id: string')
    killAgent(id)
  })
}

// ── Test-only exports ─────────────────────────────────────────────────────────

export const _testing = {
  toWslPath,
  buildClaudeCmd,
  buildEnv,
  killAgent,
  agents,
  webContentsAgents,
  getActiveTasksLine,
}
