/**
 * Agent stream management for KanbAgent.
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
 * Spawn strategies are in src/main/spawn/. Stream handlers in src/main/spawn/stream-handlers.ts.
 *
 * @module agent-stream
 */
import { ipcMain, app } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { queryLive, assertDbPathAllowed } from './db'
import {
  CLAUDE_CMD_REGEX,
  UUID_REGEX,
  logDebug,
  getActiveTasksLine,
} from './agent-stream-helpers'
import type { CliAdapter } from '../shared/cli-types'
import { getAdapter } from './adapters/index'
import { createWorktree, copyWorktreeConfigs, type WorktreeInfo } from './worktree-manager'
import {
  agents,
  webContentsAgents,
  incrementAgentId,
  killAgent,
  killAllAgents,
  type AgentCreateOpts,
} from './agent-stream-registry'
import { resolveSpawnFn } from './spawn/index'
import { attachStreamHandlers } from './spawn/stream-handlers'
import { resolvePermission, type PermissionDecision } from './hookServer'

// Re-export _testing for backward compat with spec files
export { _testing } from './agent-stream-registry'

// Maps agent ID → adapter, used by agent:send to format stdin messages correctly.
const agentAdapters = new Map<string, CliAdapter>()

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
        // T1920: Copy non-git-tracked CLI config files into the worktree
        await copyWorktreeConfigs(opts.projectPath, worktreeInfo.path, opts.cli ? [opts.cli] : undefined)
      } catch (err) {
        // Non-fatal: log and fall back to projectPath
        console.warn('[agent-stream] worktree creation failed, falling back to projectPath:', err)
      }
    }

    // T1802: Resolve model ID — agent.preferred_model → default_model_<cli> config → legacy fallback → undefined.
    // Generic for all CLIs (replaces OpenCode-specific resolution from T1356).
    if (!opts.modelId && opts.dbPath && Number.isInteger(opts.sessionId) && opts.sessionId! > 0) {
      try {
        assertDbPathAllowed(opts.dbPath)
        const agentRows = await queryLive(
          opts.dbPath,
          `SELECT a.preferred_model FROM sessions s JOIN agents a ON a.id = s.agent_id WHERE s.id = ?`,
          [opts.sessionId]
        ) as Array<{ preferred_model: string | null }>
        const agentModel = agentRows[0]?.preferred_model ?? null

        const cliName = opts.cli ?? 'claude'
        const configKey = `default_model_${cliName}`
        // Read both the new generic key and the legacy opencode key in one query
        const configRows = await queryLive(
          opts.dbPath,
          `SELECT key, value FROM config WHERE key IN (?, 'opencode_default_model')`,
          [configKey]
        ) as Array<{ key: string; value: string | null }>
        const configMap = new Map(configRows.map(r => [r.key, r.value]))
        // Prefer new generic key, fall back to legacy key for opencode backward compat
        const globalModel = configMap.get(configKey) ?? (cliName === 'opencode' ? configMap.get('opencode_default_model') : null) ?? null

        const resolved = agentModel || globalModel || undefined
        if (resolved) opts.modelId = resolved
      } catch { /* never block spawn on model resolution failure */ }
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
      spTempFile = join(tmpdir(), `ka-sp-${id}.txt`)
      await writeFile(spTempFile, effectiveSystemPrompt, 'utf-8')
    }

    // T1107: Write settings JSON to a temp file for Windows native (.cmd wrapper bypass).
    let settingsTempFile: string | undefined
    if (process.platform === 'win32' && opts.wslDistro === 'local' && opts.thinkingMode === 'disabled') {
      settingsTempFile = join(tmpdir(), `ka-settings-${id}.json`)
      await writeFile(settingsTempFile, JSON.stringify({ alwaysThinkingEnabled: false }), 'utf-8')
    }

    // ── Spawn: delegate to platform strategy ─────────────────────────────────
    const spawnFn = resolveSpawnFn(process.platform, opts.wslDistro)
    const { proc, scriptTempFile } = spawnFn({ id, adapter, validConvId, opts, worktreeInfo, spTempFile, settingsTempFile })

    agents.set(id, proc)
    agentAdapters.set(id, adapter)

    // singleShotStdin adapters (e.g. opencode) pass initialMessage as a positional arg and then
    // block waiting for stdin EOF. Close stdin immediately so the process can proceed.
    // Without this, opencode (bun) hangs indefinitely when spawned with an open pipe on stdin.
    if (adapter.singleShotStdin && opts.initialMessage && proc.stdin && !proc.stdin.writableEnded) {
      proc.stdin.end()
    }

    attachStreamHandlers({
      proc, id, wcId, adapter, worktreeInfo, spTempFile, settingsTempFile, scriptTempFile,
      sessionId: opts.sessionId, projectPath: opts.projectPath, dbPath: opts.dbPath, agentAdapters,
    })

    return id
  })

  ipcMain.handle('agent:send', (_event, id: string, text: string) => {
    if (typeof id !== 'string' || typeof text !== 'string') {
      throw new Error('agent:send requires id: string and text: string')
    }
    const proc = agents.get(id)
    if (!proc || !proc.stdin) throw new Error(`No active agent process for id=${id}`)
    if (proc.stdin.writableEnded) throw new Error(`Agent stdin is closed (id=${id})`)
    const adapter = agentAdapters.get(id)
    const msg = adapter?.formatStdinMessage?.(text)
      ?? JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n'
    proc.stdin.write(msg)
    if (adapter?.singleShotStdin) proc.stdin.end()
  })

  ipcMain.handle('agent:kill', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('agent:kill requires id: string')
    killAgent(id)
  })

  // T1816: Resolve a pending PermissionRequest from the hook server.
  // Called by the renderer when the user approves or denies a tool permission.
  ipcMain.handle('agent:permission-respond', (_event, permissionId: string, behavior: string) => {
    if (typeof permissionId !== 'string' || (behavior !== 'allow' && behavior !== 'deny')) {
      throw new Error('agent:permission-respond requires permissionId: string and behavior: "allow" | "deny"')
    }
    const decision: PermissionDecision = { behavior: behavior as 'allow' | 'deny' }
    const resolved = resolvePermission(permissionId, decision)
    if (!resolved) {
      console.warn(`[agent-stream] permission-respond: unknown or expired permissionId=${permissionId}`)
    }
    return resolved
  })
}
