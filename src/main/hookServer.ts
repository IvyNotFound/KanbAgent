/**
 * Hook server — embedded HTTP server for Claude Code lifecycle hooks (T737, T741)
 *
 * Listens on 0.0.0.0:27182 (HOOK_PORT) and handles POST requests from
 * Claude Code HTTP hooks (type: "http"). Handles:
 * - POST /hooks/stop          → parse JSONL transcript, update session tokens in DB
 * - POST /hooks/session-start → log event + push IPC hook:event to renderer
 * - POST /hooks/subagent-start → log event + push IPC hook:event
 * - POST /hooks/subagent-stop  → log event + push IPC hook:event
 * - POST /hooks/pre-tool-use   → push IPC hook:event (no DB write — high volume)
 * - POST /hooks/post-tool-use  → push IPC hook:event (no DB write — high volume)
 * - POST /hooks/instructions-loaded → push IPC hook:event (InstructionsLoaded)
 *
 * Uses better-sqlite3 via writeDb() (same as IPC handlers).
 * Always returns 2xx to avoid blocking Claude Code shutdown.
 *
 * @module hookServer
 */

import http from 'http'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import { writeDbNative, assertProjectPathAllowed, assertTranscriptPathAllowed } from './db'
import { HOOK_PORT, getHookSecret, initHookSecret, detectWslGatewayIp } from './hookServer-inject'
import { parseTokensFromJSONLStream, type TokenCounts } from './hookServer-tokens'
import { checkPostToolUseFileSize } from './hookServer-filesize'

// Re-exports for backward compatibility
export { HOOK_PORT } from './hookServer-inject'
export { injectHookSecret, detectWslGatewayIp, injectHookUrls, injectIntoWslDistros, injectGeminiHooks, injectCodexHooks } from './hookServer-inject'
export { getHookSecret } from './hookServer-inject'
export { parseTokensFromJSONL, parseTokensFromJSONLStream } from './hookServer-tokens'
export type { TokenCounts } from './hookServer-tokens'
export { updateFileSizeConfig } from './hookServer-filesize'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HookEvent {
  event: string
  payload: unknown
  ts: number
}

interface StopPayload {
  hook_event_name?: string
  session_id?: string
  transcript_path?: string
  cwd?: string
}

// ── Window reference (set after BrowserWindow creation) ───────────────────────

let hookWindow: BrowserWindow | null = null

/**
 * Set the BrowserWindow to use for IPC pushes (hook:event channel).
 * Call this after createWindow() in main/index.ts.
 */
export function setHookWindow(win: BrowserWindow): void {
  hookWindow = win
}

// ── IPC push ─────────────────────────────────────────────────────────────────

const HOOK_PAYLOAD_MAX_BYTES = 64 * 1024 // 64 KB

function truncateHookPayload(payload: unknown): unknown {
  const json = JSON.stringify(payload)
  if (json.length <= HOOK_PAYLOAD_MAX_BYTES) return payload
  // Truncate to a safe size and mark as truncated
  const truncated = json.slice(0, HOOK_PAYLOAD_MAX_BYTES)
  try {
    // Return a wrapper so the renderer knows it was cut
    return { _truncated: true, _raw: truncated }
  } catch {
    return { _truncated: true }
  }
}

function pushHookEvent(eventName: string, payload: unknown): void {
  const win = hookWindow
  if (!win || win.isDestroyed()) return
  const safePayload = truncateHookPayload(payload)
  const event: HookEvent = { event: eventName, payload: safePayload, ts: Date.now() }
  win.webContents.send('hook:event', event)
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
async function handleStop(payload: StopPayload): Promise<void> {
  pushHookEvent('Stop', payload)

  const { session_id: convId, transcript_path: transcriptPath, cwd } = payload

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
      const byConvIdRow = db.prepare('SELECT id FROM sessions WHERE claude_conv_id = ?').get(convId) as { id: number } | undefined
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
async function handleLifecycleEvent(
  eventName: string,
  payload: Record<string, unknown>,
  persistDb: boolean
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
      const row = db.prepare('SELECT s.id, s.agent_id FROM sessions s WHERE s.claude_conv_id = ?').get(convId) as { id: number; agent_id: number } | undefined
      if (!row) return

      db.prepare('INSERT INTO agent_logs (session_id, agent_id, level, action, detail, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))')
        .run(row.id, row.agent_id, 'info', eventName, JSON.stringify(payload))
    })
  } catch (err) {
    console.warn(`[hookServer] agent_logs insert failed for ${eventName}:`, err)
  }
}

// ── Permission request handler (T1816) ──────────────────────────────────────

/** Default timeout for pending permission requests (ms). */
const PERMISSION_TIMEOUT_MS = 120_000

/** Maximum number of concurrent pending permission requests. Beyond this, new requests are denied immediately. */
export const MAX_PENDING_PERMISSIONS = 50

interface PendingPermission {
  resolve: (decision: PermissionDecision) => void
  timer: ReturnType<typeof setTimeout>
}

export interface PermissionDecision {
  behavior: 'allow' | 'deny'
  reason?: string
}

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
function handlePermissionRequest(
  payload: Record<string, unknown>,
  res: http.ServerResponse
): void {
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
  const win = hookWindow
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

// ── Server ────────────────────────────────────────────────────────────────────

const LIFECYCLE_ROUTES: Record<string, boolean> = {
  '/hooks/session-start':  true,  // persistDb = true
  '/hooks/subagent-start': true,
  '/hooks/subagent-stop':  true,
  '/hooks/pre-tool-use':        false, // high volume — IPC only, no DB write
  '/hooks/post-tool-use':       false,
  '/hooks/instructions-loaded': false, // IPC only — potentially high volume
}

/**
 * Handle returned by startHookServer. Wraps one or two http.Server instances
 * (primary on 127.0.0.1, optional WSL gateway) and pending retry timers.
 */
export interface HookServerHandle {
  /** Primary server (127.0.0.1) — exposed for tests */
  primaryServer: http.Server
  /** WSL gateway server, if bound (null until WSL adapter detected) */
  wslServer: http.Server | null
  /** Close all servers and cancel pending WSL retries */
  close(callback?: () => void): void
}

/** Backoff delays for WSL gateway detection retries (ms) */
const WSL_RETRY_DELAYS = [5_000, 15_000, 30_000]

/**
 * Create the shared HTTP request handler used by both primary and WSL servers.
 */
function createRequestHandler(secret: string): http.RequestListener {
  return (req, res) => {
    // Only accept POST /hooks/*
    if (req.method !== 'POST' || !req.url?.startsWith('/hooks/')) {
      res.writeHead(404)
      res.end()
      return
    }

    // Auth check — always respond 2xx to not block Claude Code, but skip if unauthorized
    const authHeader = req.headers['authorization']
    if (authHeader !== `Bearer ${secret}`) {
      console.warn('[hookServer] Unauthorized request rejected (bad or missing Authorization header)')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
      return
    }

    const MAX_BODY_SIZE = 1 * 1024 * 1024 // 1 MB
    let bodySize = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      bodySize += c.length
      if (bodySize > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end('{"error":"Payload too large"}')
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString()
        chunks.length = 0 // release buffer references immediately
        const payload = JSON.parse(raw) as Record<string, unknown>
        const url = req.url!

        // PermissionRequest is BLOCKING — holds HTTP response until user decides (T1816)
        if (url === '/hooks/permission-request') {
          handlePermissionRequest(payload, res)
          return
        }

        // PostToolUse: synchronous file-size check before responding (T1898)
        if (url === '/hooks/post-tool-use') {
          const body = checkPostToolUseFileSize(payload)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(body))
          handleLifecycleEvent('PostToolUse', payload, false).catch(err =>
            console.error('[hookServer] handleLifecycleEvent(PostToolUse) error:', err)
          )
          return
        }

        // All other hooks respond 2xx immediately — must never block Claude Code
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{}')

        if (url === '/hooks/stop') {
          handleStop(payload as StopPayload).catch(err =>
            console.error('[hookServer] handleStop error:', err)
          )
        } else if (url in LIFECYCLE_ROUTES) {
          const persistDb = LIFECYCLE_ROUTES[url]
          const raw = url.replace('/hooks/', '').replace(/-./g, m => m[1].toUpperCase())
          const eventName = raw.charAt(0).toUpperCase() + raw.slice(1)
          handleLifecycleEvent(eventName, payload, persistDb).catch(err =>
            console.error(`[hookServer] handleLifecycleEvent(${eventName}) error:`, err)
          )
        }
      } catch (err) {
        console.warn('[hookServer] Failed to parse hook payload:', err)
        if (!res.headersSent) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{}')
        }
      }
    })

    req.on('error', (err) => {
      console.warn('[hookServer] Request error:', err)
      if (!res.headersSent) {
        res.writeHead(200)
        res.end('{}')
      }
    })
  }
}

/**
 * Start the embedded HTTP hook server with dual-listen support (T1905).
 *
 * Always binds a primary server on 127.0.0.1:HOOK_PORT for local traffic.
 * On Windows, attempts to also bind on the WSL gateway IP so that Claude Code
 * running inside WSL can reach the server. If WSL is not ready at startup,
 * retries with exponential backoff (5s, 15s, 30s — max 3 attempts).
 *
 * NOTE: 0.0.0.0 is intentionally avoided — Bearer secret is the only auth layer
 * and binding to all interfaces unnecessarily enlarges the attack surface.
 *
 * @param userDataPath - Electron userData path for persisting the auth secret.
 *   If omitted, a fresh random secret is generated per process (not persisted).
 * @returns A HookServerHandle (call handle.close() on app quit)
 */
export function startHookServer(userDataPath?: string): HookServerHandle {
  initHookSecret(userDataPath)
  const hookSecret = getHookSecret()
  const handler = createRequestHandler(hookSecret)

  // ── Primary server: always on 127.0.0.1 ──────────────────────────────────
  const primaryServer = http.createServer(handler)

  primaryServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[hookServer] Port ${HOOK_PORT} already in use on 127.0.0.1 — primary hook server disabled.`)
    } else {
      console.error('[hookServer] Server error:', err)
    }
  })

  primaryServer.listen(HOOK_PORT, '127.0.0.1', () => {
    console.log(`[hookServer] Listening on 127.0.0.1:${HOOK_PORT}`)
  })

  // ── Handle (declared early so tryBindWsl can update wslServer) ──────────
  const handle: HookServerHandle = {
    primaryServer,
    wslServer: null,
    close(callback?: () => void) {
      if (wslRetryTimer) {
        clearTimeout(wslRetryTimer)
        wslRetryTimer = null
      }
      let pending = handle.wslServer ? 2 : 1
      const done = (): void => { if (--pending === 0 && callback) callback() }
      primaryServer.close(done)
      if (handle.wslServer) handle.wslServer.close(done)
    },
  }

  // ── WSL gateway server: bind with retry if adapter not yet available ──────
  let wslRetryTimer: ReturnType<typeof setTimeout> | null = null

  function tryBindWsl(attempt: number): void {
    const wslIp = detectWslGatewayIp()
    if (!wslIp) {
      if (attempt < WSL_RETRY_DELAYS.length) {
        const delay = WSL_RETRY_DELAYS[attempt]
        console.log(`[hookServer] WSL gateway not found, retry ${attempt + 1}/${WSL_RETRY_DELAYS.length} in ${delay / 1000}s`)
        wslRetryTimer = setTimeout(() => tryBindWsl(attempt + 1), delay)
      } else {
        console.warn('[hookServer] WSL gateway not found after 3 retries — WSL listener disabled')
      }
      return
    }

    const server = http.createServer(handler)
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[hookServer] Port ${HOOK_PORT} already in use on ${wslIp} — WSL listener disabled`)
      } else {
        console.error(`[hookServer] WSL server error on ${wslIp}:`, err)
      }
      handle.wslServer = null
    })
    server.listen(HOOK_PORT, wslIp, () => {
      console.log(`[hookServer] Listening on ${wslIp}:${HOOK_PORT} (WSL gateway)`)
    })
    handle.wslServer = server
  }

  tryBindWsl(0)

  return handle
}
