/**
 * Agent stream — process registry, stream batching, and kill helpers.
 *
 * Extracted from agent-stream.ts (T1131) to keep file size under 400 lines.
 *
 * @module agent-stream-registry
 */
import type { ChildProcess } from 'child_process'
import { execFile } from 'child_process'
import { webContents } from 'electron'
import { toWslPath } from './utils/wsl'
import {
  CLAUDE_CMD_REGEX,
  UUID_REGEX,
  MAX_STDERR_BUFFER_SIZE,
  buildClaudeCmd,
  buildWindowsPS1Script,
  buildEnv,
  buildWindowsEnv,
  getActiveTasksLine,
} from './agent-stream-helpers'

// ── Process registry ──────────────────────────────────────────────────────────

export const agents = new Map<string, ChildProcess>()

// Track which agent IDs belong to each WebContents (for auto-cleanup on renderer destroy)
export const webContentsAgents = new Map<number, Set<string>>()

export let nextAgentId = 1
export function incrementAgentId(): string {
  return String(nextAgentId++)
}

// ── Stream batching (T1137) ───────────────────────────────────────────────────
// Accumulate stream events and flush every 32ms to reduce Mojo IPC buffer pressure.

const STREAM_BATCH_INTERVAL_MS = 32
const STREAM_MAX_BATCH_SIZE = 100

export const streamBatches = new Map<string, Record<string, unknown>[]>()
export const streamTimers = new Map<string, ReturnType<typeof setInterval>>()

export function flushStreamBatch(id: string, wcId: number): void {
  const batch = streamBatches.get(id)
  if (!batch || batch.length === 0) return
  const wc = webContents.fromId(wcId)
  if (wc && !wc.isDestroyed()) {
    wc.send(`agent:stream:${id}`, batch.splice(0))
  } else {
    batch.splice(0)
  }
}

export function pushStreamEvent(id: string, wcId: number, event: Record<string, unknown>): void {
  let batch = streamBatches.get(id)
  if (!batch) {
    batch = []
    streamBatches.set(id, batch)
    const timer = setInterval(() => flushStreamBatch(id, wcId), STREAM_BATCH_INTERVAL_MS)
    streamTimers.set(id, timer)
  }
  batch.push(event)
  if (batch.length >= STREAM_MAX_BATCH_SIZE) {
    flushStreamBatch(id, wcId)
  }
}

export function cleanupStreamBatch(id: string, wcId: number): void {
  flushStreamBatch(id, wcId)
  const timer = streamTimers.get(id)
  if (timer) {
    clearInterval(timer)
    streamTimers.delete(id)
  }
  streamBatches.delete(id)
}

export function sendTerminalEvent(id: string, wcId: number, event: Record<string, unknown>): void {
  cleanupStreamBatch(id, wcId)
  const wc = webContents.fromId(wcId)
  if (wc && !wc.isDestroyed()) {
    wc.send(`agent:stream:${id}`, [event])
  }
}

// ── Kill helpers ──────────────────────────────────────────────────────────────

/**
 * Kill a single agent process and clean up registry.
 * On Windows, also runs taskkill /F /T to terminate the full wsl.exe process tree.
 */
export function killAgent(id: string): void {
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
export function killAllAgents(): void {
  for (const id of [...agents.keys()]) {
    killAgent(id)
  }
  webContentsAgents.clear()
}

// ── AgentCreateOpts type ──────────────────────────────────────────────────────

export interface AgentCreateOpts {
  cli?: string
  cols?: number
  rows?: number
  projectPath?: string
  workDir?: string
  wslDistro?: string
  systemPrompt?: string
  thinkingMode?: string
  claudeCommand?: string
  convId?: string
  permissionMode?: string
  dbPath?: string
  sessionId?: number
  claudeBinaryPath?: string
  worktree?: boolean
}

// ── Test-only exports ─────────────────────────────────────────────────────────

export const _testing = {
  toWslPath,
  buildClaudeCmd,
  buildWindowsPS1Script,
  buildEnv,
  buildWindowsEnv,
  killAgent,
  agents,
  webContentsAgents,
  getActiveTasksLine,
  streamBatches,
  streamTimers,
  CLAUDE_CMD_REGEX,
  UUID_REGEX,
  MAX_STDERR_BUFFER_SIZE,
}
