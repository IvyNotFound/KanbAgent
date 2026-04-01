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
import { writeDbNative, assertDbPathAllowed } from './db'
import { HOOK_PORT, getHookSecret, initHookSecret, detectWslGatewayIp } from './hookServer-inject'
import { parseTokensFromJSONLStream, type TokenCounts } from './hookServer-tokens'

// Re-exports for backward compatibility
export { HOOK_PORT } from './hookServer-inject'
export { injectHookSecret, detectWslGatewayIp, injectHookUrls, injectIntoWslDistros, injectGeminiHooks, injectCodexHooks } from './hookServer-inject'
export { getHookSecret } from './hookServer-inject'
export { parseTokensFromJSONL, parseTokensFromJSONLStream } from './hookServer-tokens'
export type { TokenCounts } from './hookServer-tokens'

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

  const dbPath = join(cwd, '.claude', 'project.db')

  try {
    assertDbPathAllowed(dbPath)
  } catch {
    console.warn('[hookServer] handleStop: cwd not in allowlist, ignoring', cwd)
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

  const dbPath = join(cwd, '.claude', 'project.db')

  try {
    assertDbPathAllowed(dbPath)
  } catch {
    console.warn('[hookServer] handleLifecycleEvent: cwd not in allowlist, ignoring', cwd)
    return
  }

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
 * Start the embedded HTTP hook server.
 *
 * Tries port HOOK_PORT (27182). If the port is already in use, logs a warning
 * and continues — Claude Code hooks will fail silently (non-blocking per spec).
 *
 * @param userDataPath - Electron userData path for persisting the auth secret.
 *   If omitted, a fresh random secret is generated per process (not persisted).
 * @returns The http.Server instance (call server.close() on app quit)
 */
export function startHookServer(userDataPath?: string): http.Server {
  initHookSecret(userDataPath)
  const hookSecret = getHookSecret()

  const server = http.createServer((req, res) => {
    // Only accept POST /hooks/*
    if (req.method !== 'POST' || !req.url?.startsWith('/hooks/')) {
      res.writeHead(404)
      res.end()
      return
    }

    // Auth check — always respond 2xx to not block Claude Code, but skip if unauthorized
    const authHeader = req.headers['authorization']
    if (authHeader !== `Bearer ${hookSecret}`) {
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
      // Always respond 2xx immediately — hooks must never block Claude Code
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')

      try {
        const raw = Buffer.concat(chunks).toString()
        chunks.length = 0 // release buffer references immediately
        const payload = JSON.parse(raw) as Record<string, unknown>
        const url = req.url!

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
      }
    })

    req.on('error', (err) => {
      console.warn('[hookServer] Request error:', err)
      if (!res.headersSent) {
        res.writeHead(200)
        res.end('{}')
      }
    })
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[hookServer] Port ${HOOK_PORT} already in use — hook server disabled. Tokens will not be captured via HTTP hook.`)
    } else {
      console.error('[hookServer] Server error:', err)
    }
  })

  // Bind to loopback by default to avoid exposing the hook server to the LAN.
  // On Windows with WSL, bind to the WSL gateway IP so WSL processes can reach the server
  // via the Windows vEthernet WSL interface (127.0.0.1 is not reachable from inside WSL).
  // NOTE: 0.0.0.0 is intentionally avoided — Bearer secret is the only auth layer
  // and binding to all interfaces unnecessarily enlarges the attack surface.
  const listenHost = detectWslGatewayIp() ?? '127.0.0.1'
  server.listen(HOOK_PORT, listenHost, () => {
    const addr = server.address()
    const port = typeof addr === 'object' && addr !== null ? addr.port : HOOK_PORT
    console.log(`[hookServer] Listening on ${listenHost}:${port}`)
  })

  return server
}
