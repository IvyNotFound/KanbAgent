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
import type { CliAdapter } from '../../shared/cli-types'
import type { WorktreeInfo } from '../worktree-manager'
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

export interface StreamHandlerOpts {
  proc: ChildProcess
  id: string
  wcId: number
  adapter: CliAdapter
  worktreeInfo: WorktreeInfo | undefined
  spTempFile: string | undefined
  settingsTempFile: string | undefined
  scriptTempFile: string | undefined
  sessionId: number | undefined
  projectPath: string | undefined
  agentAdapters: Map<string, CliAdapter>
}

/** Wire readline + stderr + error + close handlers. Call once per spawn. */
export function attachStreamHandlers({
  proc,
  id,
  wcId,
  adapter,
  worktreeInfo,
  spTempFile,
  settingsTempFile,
  scriptTempFile,
  sessionId,
  projectPath,
  agentAdapters,
}: StreamHandlerOpts): void {
  let eventsReceived = 0
  let stderrBuffer = ''
  let stdoutErrorBuffer = '' // WSL errors go to stdout, not stderr

  // For non-Claude CLIs: forward stderr lines in real time so the user can see diagnostic info
  // (API key errors, config issues) without waiting for process close (T1248).
  // For Claude: buffer silently, only shown via error:exit if no events received (T697).
  let rlStderr: ReturnType<typeof createInterface> | undefined
  if (adapter.cli !== 'claude') {
    rlStderr = createInterface({ input: proc.stderr! })
    rlStderr.on('line', (line) => {
      const clean = line.trim()
      if (!clean) return
      pushStreamEvent(id, wcId, { type: 'error', text: `[stderr] ${clean}` })
      eventsReceived++
      stderrBuffer = (stderrBuffer + '\n' + clean).slice(-MAX_STDERR_BUFFER_SIZE)
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

    const event = adapter.parseLine(clean)
    if (event === null) {
      const readable = clean.replace(/\x00/g, '').replace(/  +/g, ' ').trim()
      if (readable) {
        stdoutErrorBuffer = (stdoutErrorBuffer + '\n' + readable).slice(-1000)
      }
      return
    }

    eventsReceived++

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
    agentAdapters.delete(id)
    webContentsAgents.get(wcId)?.delete(id)
    if (spTempFile) try { unlinkSync(spTempFile) } catch { /* cleanup best-effort */ }
    if (settingsTempFile) try { unlinkSync(settingsTempFile) } catch { /* cleanup best-effort */ }
    if (scriptTempFile) try { unlinkSync(scriptTempFile) } catch { /* cleanup best-effort */ }
    if (worktreeInfo && projectPath) {
      removeWorktree(projectPath, sessionId!).catch(() => { /* best-effort */ })
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
