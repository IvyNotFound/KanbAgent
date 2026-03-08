/**
 * Agent stream management for agent-viewer.
 *
 * Implements ADR-009: child_process.spawn + stdio:pipe for Claude Code agent sessions.
 * Replaces the node-pty approach for stream-json sessions — avoids ANSI injection,
 * line wrapping, and enables true multi-turn via stdin JSONL without respawning.
 *
 * Architecture — spawn routing by CLI×environment:
 * - Claude / WSL:         wsl.exe [...] -- bash -l <script.sh>  (script: exec claude ...)
 * - Claude / Local Win:   powershell.exe -File <script.ps1>      (T916)
 * - Non-Claude / WSL:     wsl.exe [...] -- bash -l <script.sh>  (script: source ~/.bashrc; exec <cli> ...)
 * - Non-Claude / Local Win: spawn(binary, args, { shell: true }) (handles .cmd/.bat wrappers)
 * - readline on stdout → JSONL events, 0 ANSI corruption
 * - proc.stdin.write() for multi-turn messages (no respawn)
 * - convId extracted from system:init event (no banner scanning needed)
 *
 * @module agent-stream
 */
import { ipcMain, webContents, app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { toWslPath } from './utils/wsl'
import { queryLive, assertDbPathAllowed } from './db'
import {
  CLAUDE_CMD_REGEX,
  UUID_REGEX,
  MAX_STDERR_BUFFER_SIZE,
  logDebug,
  buildEnv,
  buildWindowsEnv,
  buildClaudeCmd,
  buildWindowsPS1Script,
  getActiveTasksLine,
} from './agent-stream-helpers'
import { getAdapter } from './adapters/index'
import { createWorktree, removeWorktree, type WorktreeInfo } from './worktree-manager'
import {
  agents,
  webContentsAgents,
  incrementAgentId,
  pushStreamEvent,
  cleanupStreamBatch,
  sendTerminalEvent,
  killAgent,
  killAllAgents,
  type AgentCreateOpts,
} from './agent-stream-registry'

// Re-export _testing for backward compat with spec files
export { _testing } from './agent-stream-registry'

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
 * - `agent:stream:<id>` `{ type: 'error:spawn', error }` — process failed to start
 * - `agent:stream:<id>` `{ type: 'error:exit', error, stderr? }` — process exited without output
 * - `agent:convId:<id>` — session_id extracted from system:init event
 * - `agent:exit:<id>`   — exitCode (number | null) when process closes
 */
export function registerAgentStreamHandlers(): void {
  app.on('before-quit', killAllAgents)

  ipcMain.handle('agent:create', async (event, opts: AgentCreateOpts = {}) => {
    // Resolve adapter — defaults to Claude for backward compat
    const adapter = getAdapter(opts.cli ?? 'claude')

    // Validate custom binary name against adapter's binary pattern
    if (opts.claudeCommand) {
      const baseCmd = adapter.binaries[0] ?? 'claude'
      const cmdRegex = adapter.cli === 'claude'
        ? CLAUDE_CMD_REGEX
        : new RegExp(`^${baseCmd}(-[a-z0-9-]+)?$`)
      if (!cmdRegex.test(opts.claudeCommand)) {
        throw new Error('Invalid claudeCommand: ' + opts.claudeCommand)
      }
    }
    const validConvId = opts.convId && UUID_REGEX.test(opts.convId) ? opts.convId : undefined

    const id = incrementAgentId()
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

    // ── Worktree isolation (created first so path can be injected into system prompt — T1124) ──
    let worktreeInfo: WorktreeInfo | undefined
    if (opts.worktree !== false && opts.projectPath && Number.isInteger(opts.sessionId) && opts.sessionId! > 0) {
      try {
        worktreeInfo = await createWorktree(opts.projectPath, opts.sessionId!)
        logDebug(`worktree created: ${worktreeInfo.path} (branch ${worktreeInfo.branch})`)
      } catch (err) {
        // Non-fatal: log and fall back to projectPath
        console.warn('[agent-stream] worktree creation failed, falling back to projectPath:', err)
      }
    }

    // T772: Inject active tasks context into system prompt (DB-first, ultra-compact).
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

    // T1124: Inject worktree path + branch so the agent knows its working directory explicitly.
    if (worktreeInfo) {
      const wtLine = `Worktree: ${worktreeInfo.path} (branch: ${worktreeInfo.branch})`
      effectiveSystemPrompt = effectiveSystemPrompt
        ? effectiveSystemPrompt + '\n\n' + wtLine
        : wtLine
    }

    // Write system prompt to a Windows temp file so the child process reads it directly —
    // avoids command-line serialization issues on both WSL (T705) and Windows native (T916).
    let spTempFile: string | undefined
    if (effectiveSystemPrompt) {
      spTempFile = join(tmpdir(), `claude-sp-${id}.txt`)
      writeFileSync(spTempFile, effectiveSystemPrompt, 'utf-8')
    }

    // ── Spawn: local Windows vs WSL / Linux / macOS ────────────────────────────
    const isLocalWindows = process.platform === 'win32' && opts.wslDistro === 'local'
    let scriptTempFile: string | undefined
    let proc: ChildProcess

    // T1107: Write settings JSON to a temp file for Windows native (.cmd wrapper bypass).
    let settingsTempFile: string | undefined
    if (isLocalWindows && opts.thinkingMode === 'disabled') {
      settingsTempFile = join(tmpdir(), `claude-settings-${id}.json`)
      writeFileSync(settingsTempFile, JSON.stringify({ alwaysThinkingEnabled: false }), 'utf-8')
    }

    if (isLocalWindows) {
      if (adapter.cli === 'claude') {
        const ps1Content = buildWindowsPS1Script({
          claudeCommand: opts.claudeCommand,
          convId: validConvId,
          spTempFile,
          thinkingMode: opts.thinkingMode,
          permissionMode: opts.permissionMode,
          claudeBinaryPath: opts.claudeBinaryPath,
          settingsTempFile,
        })
        scriptTempFile = join(tmpdir(), `claude-start-${id}.ps1`)
        writeFileSync(scriptTempFile, ps1Content, 'utf-8')

        logDebug(`spawn attempt (local Windows): powershell.exe -File ${scriptTempFile}`)
        console.log('[agent-stream] spawn local Windows', scriptTempFile)

        proc = spawn('powershell.exe', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptTempFile,
        ], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: buildWindowsEnv(),
          cwd: worktreeInfo?.path ?? opts.workDir ?? opts.projectPath ?? undefined,
        })
      } else {
        const spec = adapter.buildCommand({
          convId: validConvId,
          thinkingMode: opts.thinkingMode,
          permissionMode: opts.permissionMode,
          systemPromptFile: spTempFile,
          binaryName: opts.claudeCommand,
        })
        logDebug(`spawn attempt (local Windows, ${adapter.cli}): ${spec.command} ${spec.args.join(' ')}`)
        proc = spawn(spec.command, spec.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          env: { ...buildWindowsEnv(), ...spec.env },
          cwd: worktreeInfo?.path ?? opts.workDir ?? opts.projectPath ?? undefined,
        })
      }
    } else {
      // WSL / Linux / macOS path
      const wslArgs: string[] = []
      if (opts.wslDistro && opts.wslDistro !== 'local') wslArgs.push('-d', opts.wslDistro)
      const effectiveCwd = worktreeInfo?.path ?? opts.workDir ?? opts.projectPath
      if (effectiveCwd) wslArgs.push('--cd', toWslPath(effectiveCwd))

      // Resolve wsl.exe via absolute path to avoid ENOENT in packaged app (Fix T692).
      const wslExe = process.env.SystemRoot
        ? join(process.env.SystemRoot, 'System32', 'wsl.exe')
        : 'C:\\Windows\\System32\\wsl.exe'

      if (adapter.cli === 'claude') {
        const claudeCmd = buildClaudeCmd({
          claudeCommand: opts.claudeCommand,
          convId: validConvId,
          systemPromptFile: spTempFile ? toWslPath(spTempFile) : undefined,
          thinkingMode: opts.thinkingMode,
          permissionMode: opts.permissionMode,
        })
        scriptTempFile = join(tmpdir(), `claude-start-${id}.sh`)
        writeFileSync(scriptTempFile, `#!/bin/bash\nexec ${claudeCmd}\n`, 'utf-8')
        const scriptWslPath = toWslPath(scriptTempFile)
        logDebug(`spawn attempt: exe=${wslExe} script=${scriptWslPath} args=${JSON.stringify([...wslArgs, '--', 'bash', '-l', scriptWslPath])}`)
        console.log('[agent-stream] spawn', wslExe, wslArgs)
        proc = spawn(wslExe, [...wslArgs, '--', 'bash', '-l', scriptWslPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: buildEnv(),
        })
      } else {
        const spec = adapter.buildCommand({
          convId: validConvId,
          thinkingMode: opts.thinkingMode,
          permissionMode: opts.permissionMode,
          systemPromptFile: spTempFile ? toWslPath(spTempFile) : undefined,
          binaryName: opts.claudeCommand,
        })
        const bashLine = [spec.command, ...spec.args].map(a =>
          /[\s'"\\$`!]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a
        ).join(' ')
        scriptTempFile = join(tmpdir(), `${adapter.cli}-start-${id}.sh`)
        writeFileSync(scriptTempFile, `#!/bin/bash\n[ -f ~/.bashrc ] && source ~/.bashrc\nexec ${bashLine}\n`, 'utf-8')
        const scriptWslPath = toWslPath(scriptTempFile)
        logDebug(`spawn attempt (${adapter.cli}): exe=${wslExe} script=${scriptWslPath}`)
        proc = spawn(wslExe, [...wslArgs, '--', 'bash', '-l', scriptWslPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...buildEnv(), ...spec.env },
        })
      }
    }

    agents.set(id, proc)

    let eventsReceived = 0
    let stderrBuffer = ''
    // Buffer non-JSON stdout lines for error context (WSL errors go to stdout, not stderr).
    let stdoutErrorBuffer = ''

    // Buffer stderr — do NOT emit line-by-line to avoid spamming the renderer (T697).
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuffer = (stderrBuffer + chunk.toString()).slice(-MAX_STDERR_BUFFER_SIZE)
    })

    // readline on stdout → parsed events via adapter, 0 ANSI corruption
    const rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      const clean = line.trim()
      if (!clean) return
      if (eventsReceived === 0) logDebug(`first stdout line (raw): ${line.slice(0, 200)}`)

      const event = adapter.parseLine(clean)
      if (event === null) {
        // Non-parseable line — buffer for diagnostics.
        const readable = clean.replace(/\x00/g, '').replace(/  +/g, ' ').trim()
        if (readable) {
          stdoutErrorBuffer = (stdoutErrorBuffer + '\n' + readable).slice(-1000)
        }
        return
      }

      eventsReceived++

      // Extract convId if adapter supports it (Claude: system:init event)
      const convId = adapter.extractConvId?.(event) ?? null
      if (convId) {
        const wc = webContents.fromId(wcId)
        if (wc && !wc.isDestroyed()) {
          wc.send(`agent:convId:${id}`, convId)
        }
      }

      if (!webContents.fromId(wcId) || webContents.fromId(wcId)!.isDestroyed()) {
        killAgent(id)
        return
      }
      pushStreamEvent(id, wcId, event)
    })

    proc.on('error', (err) => {
      logDebug(`spawn error id=${id}: ${err.message} (code=${(err as NodeJS.ErrnoException).code})`)
      console.error(`[agent-stream] spawn error id=${id}:`, err)
      rl.close()
      agents.delete(id)
      webContentsAgents.get(wcId)?.delete(id)
      sendTerminalEvent(id, wcId, { type: 'error:spawn', error: err.message })
    })

    proc.on('close', (exitCode) => {
      rl.close()
      agents.delete(id)
      webContentsAgents.get(wcId)?.delete(id)
      if (spTempFile) try { unlinkSync(spTempFile) } catch { /* cleanup best-effort */ }
      if (settingsTempFile) try { unlinkSync(settingsTempFile) } catch { /* cleanup best-effort */ }
      if (scriptTempFile) try { unlinkSync(scriptTempFile) } catch { /* cleanup best-effort */ }
      if (worktreeInfo && opts.projectPath) {
        removeWorktree(opts.projectPath, opts.sessionId!).catch(() => { /* best-effort */ })
      }

      logDebug(`close id=${id}: exitCode=${exitCode} eventsReceived=${eventsReceived} stderr=${stderrBuffer.slice(0, 200)} stdout_error=${stdoutErrorBuffer.slice(0, 200)}`)

      if (eventsReceived === 0) {
        const isAbnormalExit = exitCode === -1 || exitCode === 4294967295
        const stdoutCtx = stdoutErrorBuffer.trim()
        let msg: string
        if (isAbnormalExit && stdoutCtx) {
          msg = `Process exited abnormally (code ${exitCode}): ${stdoutCtx}`
        } else if (isAbnormalExit) {
          msg = `Process exited abnormally (code ${exitCode}).`
        } else if (exitCode !== 0) {
          msg = stdoutCtx
            ? `Process exited with code ${exitCode}: ${stdoutCtx}`
            : `Process exited with code ${exitCode}`
        } else {
          msg = `Process exited without producing any output (code ${exitCode})`
        }
        sendTerminalEvent(id, wcId, {
          type: 'error:exit',
          error: msg,
          stderr: stderrBuffer.trim() || undefined,
        })
      } else {
        // Flush residual buffered events before the exit signal
        cleanupStreamBatch(id, wcId)
      }
      stderrBuffer = ''
      stdoutErrorBuffer = ''

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
