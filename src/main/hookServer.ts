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
import type { BrowserWindow } from 'electron'
import { HOOK_PORT, getHookSecret, initHookSecret, detectWslGatewayIp } from './hookServer-inject'
import { checkPostToolUseFileSize } from './hookServer-filesize'
import {
  handleStop,
  handleLifecycleEvent,
  handlePermissionRequest,
  type HookEvent,
} from './hookServer-handlers'

// Re-exports for backward compatibility
export { HOOK_PORT } from './hookServer-inject'
export { injectHookSecret, detectWslGatewayIp, injectHookUrls, injectIntoWslDistros, injectGeminiHooks, injectCodexHooks } from './hookServer-inject'
export { getHookSecret } from './hookServer-inject'
export { parseTokensFromJSONL, parseTokensFromJSONLStream } from './hookServer-tokens'
export type { TokenCounts } from './hookServer-tokens'
export { updateFileSizeConfig } from './hookServer-filesize'
export { resolvePermission, pendingPermissions, MAX_PENDING_PERMISSIONS } from './hookServer-handlers'
export type { PermissionDecision, HookEvent } from './hookServer-handlers'

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
          handlePermissionRequest(payload, res, () => hookWindow)
          return
        }

        // PostToolUse: synchronous file-size check before responding (T1898)
        if (url === '/hooks/post-tool-use') {
          const body = checkPostToolUseFileSize(payload)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(body))
          handleLifecycleEvent('PostToolUse', payload, false, pushHookEvent).catch(err =>
            console.error('[hookServer] handleLifecycleEvent(PostToolUse) error:', err)
          )
          return
        }

        // All other hooks respond 2xx immediately — must never block Claude Code
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{}')

        if (url === '/hooks/stop') {
          handleStop(payload, pushHookEvent).catch(err =>
            console.error('[hookServer] handleStop error:', err)
          )
        } else if (url in LIFECYCLE_ROUTES) {
          const persistDb = LIFECYCLE_ROUTES[url]
          const raw = url.replace('/hooks/', '').replace(/-./g, m => m[1].toUpperCase())
          const eventName = raw.charAt(0).toUpperCase() + raw.slice(1)
          handleLifecycleEvent(eventName, payload, persistDb, pushHookEvent).catch(err =>
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
