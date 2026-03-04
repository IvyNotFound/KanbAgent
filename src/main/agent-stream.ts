/**
 * Agent stream management for agent-viewer.
 *
 * Implements ADR-009: child_process.spawn + stdio:pipe for Claude Code agent sessions.
 * Replaces the node-pty approach for stream-json sessions — avoids ANSI injection,
 * line wrapping, and enables true multi-turn via stdin JSONL without respawning.
 *
 * Architecture:
 * - spawn('wsl.exe', [..., 'bash', '-lc', claudeCmd], { stdio: 'pipe' })
 * - readline on stdout → JSONL events, 0 ANSI corruption
 * - proc.stdin.write() for multi-turn messages (no respawn)
 * - convId extracted from system:init event (no banner scanning needed)
 *
 * @module agent-stream
 */
import { ipcMain, webContents, app } from 'electron'
import { spawn, type ChildProcess, execFile } from 'child_process'
import { createInterface } from 'readline'
import { join } from 'path'

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
 * Converts a Windows path to its WSL mount path.
 * @param winPath - Windows-style path (e.g. `C:\Users\foo`).
 * @returns WSL path (e.g. `/mnt/c/Users/foo`).
 */
function toWslPath(winPath: string): string {
  return winPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
}

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
    'LOCALAPPDATA',
    'USERPROFILE',
    'USERNAME',
    'COMPUTERNAME',
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
 * All prompts are base64-encoded to avoid shell injection.
 * Only [A-Za-z0-9+/=] chars in base64 — safe for single-quoted shell embedding.
 */
function buildClaudeCmd(opts: {
  claudeCommand?: string
  convId?: string
  systemPrompt?: string
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

  if (opts.systemPrompt) {
    // Base64-encode to avoid shell injection — only safe chars in output
    const b64 = Buffer.from(opts.systemPrompt).toString('base64')
    parts.push(`--append-system-prompt "$(echo '${b64}' | base64 -d)"`)
  }

  if (opts.thinkingMode === 'disabled') {
    parts.push(`--settings '{"alwaysThinkingEnabled":false}'`)
  }

  if (opts.permissionMode === 'auto') {
    parts.push('--dangerously-skip-permissions')
  }

  return parts.join(' ')
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
 * - `agent:stream:<id>` — parsed JSONL event object
 * - `agent:convId:<id>` — session_id from system:init event
 * - `agent:exit:<id>`   — exitCode when process closes
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

    const claudeCmd = buildClaudeCmd({
      claudeCommand: opts.claudeCommand,
      convId: validConvId,
      systemPrompt: opts.systemPrompt,
      thinkingMode: opts.thinkingMode,
      permissionMode: opts.permissionMode,
    })

    // Resolve wsl.exe via absolute path to avoid ENOENT in packaged app where
    // C:\Windows\System32 may be absent from the spawned process PATH (Fix T692).
    const wslExe = process.env.SystemRoot
      ? join(process.env.SystemRoot, 'System32', 'wsl.exe')
      : 'C:\\Windows\\System32\\wsl.exe'

    console.log('[agent-stream] spawn', wslExe, wslArgs)
    const proc = spawn(wslExe, [...wslArgs, '--', 'bash', '-lc', claudeCmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildEnv(),
    })

    agents.set(id, proc)

    let eventsReceived = 0
    let stderrBuffer = ''

    // Capture stderr and forward each line as error:stderr event to renderer (T693)
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString()
      const lines = stderrBuffer.split('\n')
      stderrBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const clean = line.trim()
        if (!clean) continue
        const wc = webContents.fromId(wcId)
        if (wc && !wc.isDestroyed()) {
          wc.send(`agent:stream:${id}`, { type: 'error:stderr', error: clean })
        }
      }
    })

    // readline on stdout → clean JSONL lines, 0 ANSI corruption
    const rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      const clean = line.trim()
      if (!clean) return
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

      // Flush residual stderr buffer if any
      if (stderrBuffer.trim()) {
        const wc = webContents.fromId(wcId)
        if (wc && !wc.isDestroyed()) {
          wc.send(`agent:stream:${id}`, { type: 'error:stderr', error: stderrBuffer.trim() })
        }
        stderrBuffer = ''
      }

      // Signal abnormal exit if process died before emitting any stream event (T693)
      if (exitCode !== 0 && eventsReceived === 0) {
        const wc = webContents.fromId(wcId)
        if (wc && !wc.isDestroyed()) {
          wc.send(`agent:stream:${id}`, {
            type: 'error:exit',
            error: `Process exited with code ${exitCode}`,
          })
        }
      }

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
}
