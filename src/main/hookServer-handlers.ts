/**
 * Hook server — request handlers for lifecycle events, stop, and permissions.
 *
 * Extracted from hookServer.ts (T1902) to keep file size under 400 lines.
 * Dependencies (pushHookEvent, hookWindow) are injected to avoid circular imports.
 *
 * @module hookServer-handlers
 */

import http from 'http'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import { writeDbNative, assertProjectPathAllowed, assertTranscriptPathAllowed } from './db'
import { parseTokensFromJSONLStream, type TokenCounts } from './hookServer-tokens'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HookEvent {
  event: string
  payload: unknown
  ts: number
}

export interface PermissionDecision {
  behavior: 'allow' | 'deny'
  reason?: string
}

interface PendingPermission {
  resolve: (decision: PermissionDecision) => void
  timer: ReturnType<typeof setTimeout>
}

export type PushHookEventFn = (eventName: string, payload: unknown) => void
export type GetHookWindowFn = () => BrowserWindow | null

// ── Permission request handler (T1816) ──────────────────────────────────────

/** Default timeout for pending permission requests (ms). */
const PERMISSION_TIMEOUT_MS = 120_000

/** Maximum number of concurrent pending permission requests. Beyond this, new requests are denied immediately. */
export const MAX_PENDING_PERMISSIONS = 50

/**
 * Map of pending permission requests awaiting user decision.
 * Key: permission_id (UUID). Value: resolve callback + timeout timer.
 * Exported so that the IPC handler (agent:permission-respond) can resolve entries.
 */
export const pendingPermissions = new Map<string, PendingPermission>()

let permissionCounter = 0

/**
 * Handle a PermissionRequest hook from Claude Code CLI.
 *
 * Unlike other hooks, this handler is BLOCKING — it holds the HTTP response
 * open until the user approves/denies via the renderer (or a timeout fires).
 *
 * Flow:
 * 1. CLI → POST /hooks/permission-request → this handler
 * 2. Push IPC `hook:event` with type `PermissionRequest` to renderer
 * 3. Renderer shows popup → user clicks allow/deny
 * 4. Renderer → IPC `agent:permission-respond` → resolves the pending Promise
 * 5. HTTP response with decision → CLI proceeds
 */
export function handlePermissionRequest(
  payload: Record<string, unknown>,
  res: http.ServerResponse,
  getHookWindow: GetHookWindowFn
): void {
  // Guard: only handle permission requests for projects managed by this instance (ADR-013)
  const cwd = payload.cwd as string | undefined
  if (cwd) {
    try {
      assertProjectPathAllowed(cwd)
    } catch {
      console.warn('[hookServer] PermissionRequest: cwd not in allowlist — denying (not our project)', cwd)
      const body = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'deny', reason: 'Project not managed by this instance' },
        },
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(body)
      return
    }
  }

  // Cap concurrent pending permissions to prevent unbounded timer/closure accumulation
  if (pendingPermissions.size >= MAX_PENDING_PERMISSIONS) {
    console.warn(`[hookServer] PermissionRequest denied: ${pendingPermissions.size} pending (max ${MAX_PENDING_PERMISSIONS})`)
    const body = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', reason: 'Too many pending permission requests' },
      },
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(body)
    return
  }

  const permissionId = `perm_${Date.now()}_${++permissionCounter}`
  const toolName = (payload.tool_name as string) ?? 'unknown'
  const toolInput = (payload.tool_input as Record<string, unknown>) ?? {}

  // If no renderer is connected, deny immediately (safe default)
  const win = getHookWindow()
  if (!win || win.isDestroyed()) {
    console.warn('[hookServer] PermissionRequest but no renderer — denying')
    const body = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', reason: 'No renderer connected' },
      },
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(body)
    return
  }

  const promise = new Promise<PermissionDecision>((resolve) => {
    const timer = setTimeout(() => {
      pendingPermissions.delete(permissionId)
      resolve({ behavior: 'deny', reason: 'Timeout — no user response' })
    }, PERMISSION_TIMEOUT_MS)

    pendingPermissions.set(permissionId, { resolve, timer })
  })

  // Push permission_request event to renderer via existing hook:event channel
  const event: HookEvent = {
    event: 'PermissionRequest',
    payload: { ...payload, permission_id: permissionId },
    ts: Date.now(),
  }
  win.webContents.send('hook:event', event)

  // Also push as a synthetic StreamEvent on the agent:stream channel so StreamView can display it
  const sessionId = payload.session_id as string | undefined
  if (sessionId) {
    win.webContents.send('agent:permission-request', {
      permission_id: permissionId,
      tool_name: toolName,
      tool_input: toolInput,
      session_id: sessionId,
    })
  }

  console.log(`[hookServer] PermissionRequest ${permissionId}: tool=${toolName} — waiting for user decision`)

  // Hold the HTTP response open until resolved
  promise.then((decision) => {
    const body = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision,
      },
    })
    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(body)
    }
    console.log(`[hookServer] PermissionRequest ${permissionId}: → ${decision.behavior}`)
  })
}

/**
 * Resolve a pending permission request. Called by the `agent:permission-respond` IPC handler.
 * Returns true if the permission was found and resolved, false if expired/unknown.
 */
export function resolvePermission(permissionId: string, decision: PermissionDecision): boolean {
  const pending = pendingPermissions.get(permissionId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingPermissions.delete(permissionId)
  pending.resolve(decision)
  return true
}

// ── Stop handler ──────────────────────────────────────────────────────────────

/**
 * Handle the Stop hook: parse JSONL transcript, persist token counts, and
 * mark the session as completed.
 *
 * Derives DB path from `cwd` (the project root sent by Claude Code).
 * Falls back to the most recent started session if no session matches convId.
 * Sets `statut='completed'` and `ended_at=datetime('now')` on the matched
 * session if it was previously in `'started'` state.
 */
export async function handleStop(
  payload: Record<string, unknown>,
  pushHookEvent: PushHookEventFn
): Promise<void> {
  pushHookEvent('Stop', payload)

  const convId = payload.session_id as string | undefined
  const transcriptPath = payload.transcript_path as string | undefined
  const cwd = payload.cwd as string | undefined

  if (!convId || !transcriptPath || !cwd) {
    console.warn('[hookServer] /hooks/stop: missing required fields', { convId: !!convId, transcriptPath: !!transcriptPath, cwd: !!cwd })
    return
  }

  try {
    assertProjectPathAllowed(cwd)
  } catch {
    console.warn('[hookServer] handleStop: cwd not in allowlist, ignoring', cwd)
    return
  }

  const dbPath = join(cwd, '.claude', 'project.db')

  // T1871: Validate transcript_path is within cwd or ~/.claude/ before any file I/O
  try {
    assertTranscriptPathAllowed(transcriptPath, cwd)
  } catch {
    console.warn('[hookServer] handleStop: transcript_path outside allowed directories, ignoring', transcriptPath)
    return
  }

  let tokens: TokenCounts
  try {
    tokens = await parseTokensFromJSONLStream(transcriptPath)
  } catch (err) {
    console.warn('[hookServer] Cannot read transcript:', err)
    return
  }
  if (tokens.tokensIn === 0 && tokens.tokensOut === 0) return

  try {
    await writeDbNative(dbPath, (db) => {
      // 1. Try to find session by conv_id
      const byConvIdRow = db.prepare('SELECT id FROM sessions WHERE conv_id = ?').get(convId) as { id: number } | undefined
      let sessionId: number | null = byConvIdRow?.id ?? null

      // 2. Fallback: most recent started/completed session with no tokens
      if (sessionId === null) {
        const fallbackRow = db.prepare(
          "SELECT id FROM sessions WHERE (tokens_in = 0 OR tokens_in IS NULL) AND status IN ('started','completed') ORDER BY id DESC LIMIT 1"
        ).get() as { id: number } | undefined
        if (fallbackRow) {
          sessionId = fallbackRow.id
          console.warn(`[hookServer] Fallback: using session ${sessionId} (conv_id ${convId} not found)`)
        }
      }

      if (sessionId === null) {
        console.warn(`[hookServer] No session found for conv_id=${convId}`)
        return
      }

      db.prepare('UPDATE sessions SET tokens_in=?, tokens_out=?, tokens_cache_read=?, tokens_cache_write=? WHERE id=?')
        .run(tokens.tokensIn, tokens.tokensOut, tokens.cacheRead, tokens.cacheWrite, sessionId)
      db.prepare("UPDATE sessions SET status='completed', ended_at=datetime('now') WHERE id=? AND status='started'")
        .run(sessionId)
      console.log(`[hookServer] session ${sessionId}: in=${tokens.tokensIn} out=${tokens.tokensOut} cacheR=${tokens.cacheRead} cacheW=${tokens.cacheWrite} → completed`)
    })
  } catch (err) {
    console.error('[hookServer] writeDbNative failed:', err)
  }
}

// ── Lifecycle event handler ───────────────────────────────────────────────────

/**
 * Handle a lifecycle hook event (SessionStart, SubagentStart, SubagentStop).
 *
 * Pushes hook:event IPC to renderer immediately.
 * Best-effort: persists in agent_logs if a matching session is found by conv_id.
 * PreToolUse/PostToolUse are excluded from DB writes (high volume — IPC only).
 */
export async function handleLifecycleEvent(
  eventName: string,
  payload: Record<string, unknown>,
  persistDb: boolean,
  pushHookEvent: PushHookEventFn
): Promise<void> {
  pushHookEvent(eventName, payload)
  if (!persistDb) return

  const convId = payload.session_id as string | undefined
  const cwd = payload.cwd as string | undefined
  if (!convId || !cwd) return

  try {
    assertProjectPathAllowed(cwd)
  } catch {
    console.warn('[hookServer] handleLifecycleEvent: cwd not in allowlist, ignoring', cwd)
    return
  }

  const dbPath = join(cwd, '.claude', 'project.db')

  try {
    await writeDbNative(dbPath, (db) => {
      const row = db.prepare('SELECT s.id, s.agent_id FROM sessions s WHERE s.conv_id = ?').get(convId) as { id: number; agent_id: number } | undefined
      if (!row) return

      db.prepare('INSERT INTO agent_logs (session_id, agent_id, level, action, detail, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))')
        .run(row.id, row.agent_id, 'info', eventName, JSON.stringify(payload))
    })
  } catch (err) {
    console.warn(`[hookServer] agent_logs insert failed for ${eventName}:`, err)
  }
}
