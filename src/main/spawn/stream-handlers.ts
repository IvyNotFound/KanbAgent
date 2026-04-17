/**
 * Stream handler attachment for spawned agent processes.
 * Sets up readline (stdout → JSONL events), stderr buffering, error/close handlers.
 * Extracted from agent-stream.ts (T1222).
 * @module spawn/stream-handlers
 */
import { createInterface } from 'readline'
import { unlinkSync } from 'fs'
import { webContents } from 'electron'
import type { ChildProcess } from 'child_process'
import type { CliAdapter, TokenCounts } from '../../shared/cli-types'
import type { WorktreeInfo } from '../worktree-manager'
import type { SinglshotRespawnData } from './types'
import { removeWorktree } from '../worktree-manager'
import { MAX_STDERR_BUFFER_SIZE, logDebug } from '../agent-stream-helpers'
import {
  agents,
  webContentsAgents,
  pushStreamEvent,
  cleanupStreamBatch,
  sendTerminalEvent,
  killAgent,
} from '../agent-stream-registry'
import { writeDb } from '../db'

export interface StreamHandlerOpts {
  proc: ChildProcess
  id: string
  wcId: number
  adapter: CliAdapter
  worktreeInfo: WorktreeInfo | undefined
  spTempFile: string | undefined
  /** Cleanup callback returned by adapter.prepareSystemPrompt. Handles restore/delete correctly
   *  for both the opencode worktree case (.jsonc restore) and the plain .txt temp-file case. */
  spCleanup: (() => Promise<void>) | undefined
  settingsTempFile: string | undefined
  scriptTempFile: string | undefined
  sessionId: number | undefined
  projectPath: string | undefined
  /** Absolute path to the SQLite DB file. Used on process close to persist cli_type and token counts. */
  dbPath: string | undefined
  agentAdapters: Map<string, CliAdapter>
  /** Main-process convId store — updated when extractConvId fires (T1991). */
  agentConvIds?: Map<string, string>
  /** Re-spawn data for singleShotStdin adapters — accumulated tokens updated on close (T1991). */
  agentRespawnData?: Map<string, SinglshotRespawnData>
}

/** Wire readline + stderr + error + close handlers. Call once per spawn. */
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g
const OPENCODE_TUI_PREFIXES = ['→ ', '$ ', '● ', '◆ ']

export function attachStreamHandlers({
  proc,
  id,
  wcId,
  adapter,
  worktreeInfo,
  spTempFile,
  spCleanup,
  settingsTempFile,
  scriptTempFile,
  sessionId,
  projectPath,
  dbPath,
  agentAdapters,
  agentConvIds,
  agentRespawnData,
}: StreamHandlerOpts): void {
  let eventsReceived = 0
  let stderrBuffer = ''
  let stdoutErrorBuffer = '' // WSL errors go to stdout, not stderr

  // Token accumulator for non-Claude CLIs (Claude uses hook server instead)
  const tokenAccum: TokenCounts = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }

  // Dedup consecutive text events per session_id (opencode streams cumulative updates, T1992).
  const lastTextBySession = new Map<string, string>()

  // For non-Claude CLIs: forward stderr lines in real time so the user can see diagnostic info
  // (API key errors, config issues) without waiting for process close (T1248).
  // For Claude: buffer silently, only shown via error:exit if no events received (T697).
  let rlStderr: ReturnType<typeof createInterface> | undefined
  if (adapter.cli !== 'claude') {
    rlStderr = createInterface({ input: proc.stderr! })
    rlStderr.on('line', (line) => {
      const stripped = line.replace(ANSI_RE, '').trim()
      if (!stripped) return
      stderrBuffer = (stderrBuffer + '\n' + stripped).slice(-MAX_STDERR_BUFFER_SIZE)
      if (adapter.cli === 'opencode' && OPENCODE_TUI_PREFIXES.some(p => stripped.startsWith(p))) return
      pushStreamEvent(id, wcId, { type: 'error', text: `[stderr] ${stripped}` })
      eventsReceived++
    })
  } else {
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuffer = (stderrBuffer + chunk.toString()).slice(-MAX_STDERR_BUFFER_SIZE)
    })
  }

  const rl = createInterface({ input: proc.stdout! })
  rl.on('line', (line) => {
    const clean = line.trim()
    if (!clean) return
    if (eventsReceived === 0) logDebug(`first stdout line (raw): ${line.slice(0, 200)}`)

    const parsed = adapter.parseLine(clean)
    if (parsed === null) {
      const readable = clean.replace(/\x00/g, '').replace(/  +/g, ' ').trim()
      if (readable) {
        stdoutErrorBuffer = (stdoutErrorBuffer + '\n' + readable).slice(-1000)
      }
      return
    }

    // parseLine may return a single event or an array (e.g. OpenCode inline tool_result)
    const events = Array.isArray(parsed) ? parsed : [parsed]

    for (const event of events) {
      eventsReceived++

      // Accumulate token usage from adapters that support extractTokenUsage
      if (adapter.cli !== 'claude' && adapter.extractTokenUsage) {
        try {
          const usage = adapter.extractTokenUsage(event)
          if (usage) {
            tokenAccum.tokensIn  += usage.tokensIn  ?? 0
            tokenAccum.tokensOut += usage.tokensOut ?? 0
            tokenAccum.cacheRead  += usage.cacheRead  ?? 0
            tokenAccum.cacheWrite += usage.cacheWrite ?? 0
            if (typeof usage.costUsd === 'number') {
              tokenAccum.costUsd = (tokenAccum.costUsd ?? 0) + usage.costUsd
            }
          }
        } catch { /* defensive — never break stream on accumulation error */ }
      }

      const convId = adapter.extractConvId?.(event) ?? null
      if (convId) {
        agentConvIds?.set(id, convId)  // persist in main process for re-spawn (T1991)
        const wc = webContents.fromId(wcId)
        if (wc && !wc.isDestroyed()) {
          wc.send(`agent:convId:${id}`, convId)
        }
      }

      if (!webContents.fromId(wcId) || webContents.fromId(wcId)!.isDestroyed()) {
        killAgent(id)
        return
      }

      // Dedup consecutive text events: skip if identical or regression of last push (T1992).
      if (event.type === 'text' && typeof event.text === 'string') {
        const sid = (event as { session_id?: string }).session_id ?? '__nosid__'
        const last = lastTextBySession.get(sid) ?? ''
        if (event.text === last || last.startsWith(event.text)) {
          eventsReceived-- // undo the increment above — filtered event
          continue
        }
        lastTextBySession.set(sid, event.text)
      }

      pushStreamEvent(id, wcId, event)

      // T1708: normalize Claude AskUserQuestion tool_use into a synthetic ask_user event.
      // This allows non-Claude-aware consumers to detect pending questions via type === 'ask_user'
      // without parsing the assistant message content structure.
      if (adapter.cli === 'claude' && event.type === 'assistant' && event.message) {
        const askBlock = event.message.content.find(
          (b) => b.type === 'tool_use' && b.name === 'AskUserQuestion'
        )
        if (askBlock?.input) {
          const question = (askBlock.input as Record<string, unknown>).question
          if (typeof question === 'string') {
            pushStreamEvent(id, wcId, { type: 'ask_user', text: question })
          }
        }
      }
    }
  })

  proc.on('error', (err) => {
    logDebug(`spawn error id=${id}: ${err.message} (code=${(err as NodeJS.ErrnoException).code})`)
    console.error(`[agent-stream] spawn error id=${id}:`, err)
    rl.close()
    rlStderr?.close()
    agents.delete(id)
    agentAdapters.delete(id)
    webContentsAgents.get(wcId)?.delete(id)
    sendTerminalEvent(id, wcId, { type: 'error:spawn', error: err.message })
  })

  proc.on('close', (exitCode) => {
    rl.close()
    rlStderr?.close()
    agents.delete(id)
    // singleShotStdin (opencode): keep adapter + webContents registration so re-spawn works (T1991)
    if (!adapter.singleShotStdin || !agentRespawnData?.has(id)) {
      agentAdapters.delete(id)
      webContentsAgents.get(wcId)?.delete(id)
    }
    if (spCleanup) spCleanup().catch(() => { /* cleanup best-effort */ })
    else if (spTempFile) try { unlinkSync(spTempFile) } catch { /* cleanup best-effort */ }
    if (settingsTempFile) try { unlinkSync(settingsTempFile) } catch { /* cleanup best-effort */ }
    if (scriptTempFile) try { unlinkSync(scriptTempFile) } catch { /* cleanup best-effort */ }
    if (worktreeInfo && projectPath) {
      removeWorktree(projectPath, sessionId!).catch(() => { /* best-effort */ })
    }

    logDebug(`close id=${id}: exitCode=${exitCode} eventsReceived=${eventsReceived} stderr=${stderrBuffer.slice(0, 200)} stdout_error=${stdoutErrorBuffer.slice(0, 200)}`)

    // Persist cli_type and (for non-Claude CLIs) accumulated token counts to DB.
    // For singleShotStdin adapters: accumulate across re-spawns into agentRespawnData (T1991).
    if (dbPath && sessionId) {
      let effectiveAccum = tokenAccum
      const rd = adapter.singleShotStdin ? agentRespawnData?.get(id) : undefined
      if (rd) {
        rd.prevTokenAccum.tokensIn += tokenAccum.tokensIn
        rd.prevTokenAccum.tokensOut += tokenAccum.tokensOut
        rd.prevTokenAccum.cacheRead += tokenAccum.cacheRead
        rd.prevTokenAccum.cacheWrite += tokenAccum.cacheWrite
        if (typeof tokenAccum.costUsd === 'number') {
          rd.prevTokenAccum.costUsd = (rd.prevTokenAccum.costUsd ?? 0) + tokenAccum.costUsd
        }
        effectiveAccum = rd.prevTokenAccum
      }
      const hasTokens = adapter.cli !== 'claude' && effectiveAccum.tokensIn > 0
      writeDb(dbPath, (db) => {
        if (hasTokens) {
          db.run(
            `UPDATE sessions SET cli_type = ?, tokens_in = ?, tokens_out = ?,
             tokens_cache_read = ?, tokens_cache_write = ?,
             cost_usd = COALESCE(?, cost_usd) WHERE id = ?`,
            [adapter.cli, effectiveAccum.tokensIn, effectiveAccum.tokensOut,
             effectiveAccum.cacheRead, effectiveAccum.cacheWrite,
             effectiveAccum.costUsd ?? null, sessionId]
          )
        } else {
          db.run(`UPDATE sessions SET cli_type = ? WHERE id = ?`, [adapter.cli, sessionId])
        }
      }).catch(err => console.error('[stream-handlers] session update error:', err))
    }

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
      cleanupStreamBatch(id, wcId) // flush residual buffered events
    }
    stderrBuffer = ''
    stdoutErrorBuffer = ''

    const wc = webContents.fromId(wcId)
    if (wc && !wc.isDestroyed()) {
      wc.send(`agent:exit:${id}`, exitCode)
    }
  })
}
