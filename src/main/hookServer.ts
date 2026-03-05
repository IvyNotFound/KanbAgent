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
 *
 * Uses sql.js via writeDb() (same as IPC handlers) — no better-sqlite3.
 * Always returns 2xx to avoid blocking Claude Code shutdown.
 *
 * @module hookServer
 */

import http from 'http'
import os from 'os'
import { join, dirname } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { execSync } from 'child_process'
import type { BrowserWindow } from 'electron'
import { writeDb } from './db'

export const HOOK_PORT = 27182

/** Hook routes managed by agent-viewer — bootstrapped automatically if absent. */
const HOOK_ROUTES: Record<string, string> = {
  Stop:          '/hooks/stop',
  SessionStart:  '/hooks/session-start',
  SubagentStart: '/hooks/subagent-start',
  SubagentStop:  '/hooks/subagent-stop',
  PreToolUse:    '/hooks/pre-tool-use',
  PostToolUse:   '/hooks/post-tool-use',
}

// ── Hook auth secret ──────────────────────────────────────────────────────────

let hookSecret = ''

/** Returns the current hook auth secret (available after startHookServer). */
export function getHookSecret(): string { return hookSecret }

function loadOrGenerateSecret(userDataPath?: string): string {
  if (userDataPath) {
    const secretFile = join(userDataPath, 'hook-secret')
    try {
      const existing = readFileSync(secretFile, 'utf-8').trim()
      if (existing.length === 64) return existing
    } catch { /* file doesn't exist yet — generate */ }
    const secret = randomBytes(32).toString('hex')
    try { writeFileSync(secretFile, secret, { mode: 0o600 }) } catch { /* ignore */ }
    return secret
  }
  return randomBytes(32).toString('hex')
}

/**
 * Inject the hook auth secret into a Claude Code settings.json file.
 * Adds `Authorization: Bearer <secret>` header to all http-type hooks.
 * Best-effort: silently skips if the file is missing or unreadable.
 */
export async function injectHookSecret(settingsPath: string): Promise<void> {
  try {
    const raw = await readFile(settingsPath, 'utf-8')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = JSON.parse(raw) as any
    if (!settings.hooks) return
    let changed = false
    for (const eventGroups of Object.values(settings.hooks as Record<string, unknown[]>)) {
      for (const group of eventGroups as Array<{ hooks?: Array<{ type: string; headers?: Record<string, string> }> }>) {
        if (!Array.isArray(group.hooks)) continue
        for (const hook of group.hooks) {
          if (hook.type === 'http') {
            const expected = `Bearer ${hookSecret}`
            if (hook.headers?.['Authorization'] !== expected) {
              hook.headers = { ...hook.headers, Authorization: expected }
              changed = true
            }
          }
        }
      }
    }
    if (changed) {
      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
      console.log('[hookServer] Injected auth secret into', settingsPath)
    }
  } catch (err) {
    console.warn('[hookServer] Could not inject secret into settings:', err)
  }
}

/**
 * Detect the Windows IP address visible from WSL (vEthernet WSL interface).
 *
 * Returns null on non-Windows platforms or when no WSL network interface is found.
 * Used to inject the correct hook server URL into .claude/settings.json so that
 * Claude Code running inside WSL can reach the Electron hook server on Windows.
 */
export function detectWslGatewayIp(): string | null {
  if (process.platform !== 'win32') return null
  const ifaces = os.networkInterfaces()
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!/wsl/i.test(name)) continue
    const ipv4 = addrs?.find((a) => a.family === 'IPv4' && !a.internal)
    if (ipv4) return ipv4.address
  }
  return null
}

/**
 * Inject the detected Windows/WSL gateway IP into all http-type hook URLs
 * in a Claude Code settings.json file.
 *
 * - If settings.json is missing: creates it with all 6 managed hooks.
 * - If settings.json exists but `hooks` is absent: adds the full hooks structure.
 * - If `hooks` is present but some events are missing: adds only the missing ones.
 * - Always updates the host of existing http hook URLs to `ip:HOOK_PORT`.
 * - Non-http hooks (type: command) are never modified.
 *
 * Best-effort: silently skips on unrecoverable errors.
 */
export async function injectHookUrls(settingsPath: string, ip: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let settings: any = {}
  let fileExists = true

  try {
    const raw = await readFile(settingsPath, 'utf-8')
    settings = JSON.parse(raw)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      fileExists = false
    } else {
      console.warn('[hookServer] Could not inject hook URLs into settings:', err)
      return
    }
  }

  let changed = false

  // Bootstrap hooks object if absent
  if (!settings.hooks) {
    settings.hooks = {}
  }

  // Add managed hook events that are missing
  for (const [event, path] of Object.entries(HOOK_ROUTES)) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = [{ hooks: [{ type: 'http', url: `http://${ip}:${HOOK_PORT}${path}` }] }]
      changed = true
    }
  }

  // Update host in existing http hook URLs
  for (const eventGroups of Object.values(settings.hooks as Record<string, unknown[]>)) {
    for (const group of eventGroups as Array<{ hooks?: Array<{ type: string; url?: string }> }>) {
      if (!Array.isArray(group.hooks)) continue
      for (const hook of group.hooks) {
        if (hook.type === 'http' && hook.url) {
          const updated = hook.url.replace(
            /^http:\/\/[^/]+\/hooks\//,
            `http://${ip}:${HOOK_PORT}/hooks/`
          )
          if (updated !== hook.url) {
            hook.url = updated
            changed = true
          }
        }
      }
    }
  }

  if (changed || !fileExists) {
    if (!fileExists) {
      await mkdir(dirname(settingsPath), { recursive: true })
    }
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
    console.log('[hookServer] Updated hook URLs with WSL gateway IP:', ip, '| created:', !fileExists)
  }
}

/**
 * Detect active WSL distros and inject hook secret + URLs into each one's
 * ~/.claude/settings.json via Windows UNC path (\\wsl.localhost\<Distro>\...).
 *
 * No-op on non-Windows or when wsl.exe is unavailable.
 * Silently skips stopped distros (UNC path unreachable).
 */
export async function injectIntoWslDistros(wslIp: string | null): Promise<void> {
  if (process.platform !== 'win32') return

  let distros: string[]
  try {
    // wsl.exe --list --quiet outputs UTF-16LE on Windows
    const raw = execSync('wsl.exe --list --quiet', { timeout: 5000 }) as Buffer
    distros = raw.toString('utf16le')
      .replace(/\0/g, '')
      .replace(/\r/g, '')
      .split('\n')
      .map((d) => d.trim())
      .filter(Boolean)
  } catch {
    console.warn('[hookServer] wsl.exe --list failed — WSL unavailable or no distros')
    return
  }

  for (const distro of distros) {
    try {
      const homeRaw = execSync(`wsl.exe -d "${distro}" -- printenv HOME`, {
        timeout: 5000,
        encoding: 'utf-8',
      }) as string
      const homeDir = homeRaw.trim()
      if (!homeDir) continue

      // Convert Linux path to Windows UNC: /home/user → \\wsl.localhost\Distro\home\user
      const winHome = homeDir.replace(/\//g, '\\')
      const settingsPath = `\\\\wsl.localhost\\${distro}${winHome}\\.claude\\settings.json`

      await injectHookSecret(settingsPath)
      if (wslIp) await injectHookUrls(settingsPath, wslIp)
      console.log(`[hookServer] Injected hooks into WSL distro ${distro}: ${settingsPath}`)
    } catch {
      // Distro stopped or unreachable — skip silently
    }
  }
}

// ── Token types ────────────────────────────────────────────────────────────────

export interface TokenCounts {
  tokensIn: number
  tokensOut: number
  cacheRead: number
  cacheWrite: number
}

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

function pushHookEvent(eventName: string, payload: unknown): void {
  const win = hookWindow
  if (!win || win.isDestroyed()) return
  const event: HookEvent = { event: eventName, payload, ts: Date.now() }
  win.webContents.send('hook:event', event)
}

// ── JSONL parsing ─────────────────────────────────────────────────────────────

/**
 * Parse token usage from a Claude Code conversation JSONL file content.
 *
 * Only counts finalized assistant messages (stop_reason != null).
 * Each API call produces two JSONL entries with the same requestId:
 *   - streaming start (stop_reason: null, output_tokens ~1)
 *   - final message  (stop_reason set, full output_tokens)
 * Only the final entry is counted to avoid double-counting.
 *
 * @param content - Raw JSONL string (newline-separated JSON objects)
 * @returns Summed token counts
 */
export function parseTokensFromJSONL(content: string): TokenCounts {
  let tokensIn = 0
  let tokensOut = 0
  let cacheRead = 0
  let cacheWrite = 0

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = JSON.parse(trimmed) as any
      if (obj.type !== 'assistant') continue
      if (!obj.message?.usage || obj.message.stop_reason == null) continue
      const u = obj.message.usage
      tokensIn   += (u.input_tokens                 ?? 0)
      tokensOut  += (u.output_tokens                ?? 0)
      cacheRead  += (u.cache_read_input_tokens       ?? 0)
      cacheWrite += (u.cache_creation_input_tokens   ?? 0)
    } catch { /* malformed line — skip */ }
  }

  return { tokensIn, tokensOut, cacheRead, cacheWrite }
}

// ── Stop handler ──────────────────────────────────────────────────────────────

/**
 * Handle the Stop hook: parse JSONL transcript and persist token counts.
 *
 * Derives DB path from `cwd` (the project root sent by Claude Code).
 * Falls back to the most recent started session if no session matches convId.
 */
async function handleStop(payload: StopPayload): Promise<void> {
  pushHookEvent('Stop', payload)

  const { session_id: convId, transcript_path: transcriptPath, cwd } = payload

  if (!convId || !transcriptPath || !cwd) {
    console.warn('[hookServer] /hooks/stop: missing required fields', { convId: !!convId, transcriptPath: !!transcriptPath, cwd: !!cwd })
    return
  }

  let content: string
  try {
    content = await readFile(transcriptPath, 'utf-8')
  } catch (err) {
    console.warn('[hookServer] Cannot read transcript:', err)
    return
  }

  const tokens = parseTokensFromJSONL(content)
  if (tokens.tokensIn === 0 && tokens.tokensOut === 0) return

  const dbPath = join(cwd, '.claude', 'project.db')

  try {
    await writeDb(dbPath, (db) => {
      // 1. Try to find session by conv_id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byConvId = db.prepare('SELECT id FROM sessions WHERE claude_conv_id = ?') as any
      byConvId.bind([convId])
      let sessionId: number | null = null
      if (byConvId.step()) {
        sessionId = (byConvId.getAsObject() as { id: number }).id
      }
      byConvId.free()

      // 2. Fallback: most recent started/completed session with no tokens
      if (sessionId === null) {
        const fallback = db.prepare(
          "SELECT id FROM sessions WHERE (tokens_in = 0 OR tokens_in IS NULL) AND statut IN ('started','completed') ORDER BY id DESC LIMIT 1"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ) as any
        if (fallback.step()) {
          sessionId = (fallback.getAsObject() as { id: number }).id
          console.warn(`[hookServer] Fallback: using session ${sessionId} (conv_id ${convId} not found)`)
        }
        fallback.free()
      }

      if (sessionId === null) {
        console.warn(`[hookServer] No session found for conv_id=${convId}`)
        return
      }

      db.run(
        'UPDATE sessions SET tokens_in=?, tokens_out=?, tokens_cache_read=?, tokens_cache_write=? WHERE id=?',
        [tokens.tokensIn, tokens.tokensOut, tokens.cacheRead, tokens.cacheWrite, sessionId]
      )
      console.log(`[hookServer] session ${sessionId}: in=${tokens.tokensIn} out=${tokens.tokensOut} cacheR=${tokens.cacheRead} cacheW=${tokens.cacheWrite}`)
    })
  } catch (err) {
    console.error('[hookServer] writeDb failed:', err)
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
    await writeDb(dbPath, (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = db.prepare('SELECT s.id, s.agent_id FROM sessions s WHERE s.claude_conv_id = ?') as any
      stmt.bind([convId])
      let sessionId: number | null = null
      let agentId: number | null = null
      if (stmt.step()) {
        const row = stmt.getAsObject() as { id: number; agent_id: number }
        sessionId = row.id
        agentId = row.agent_id
      }
      stmt.free()

      if (sessionId === null || agentId === null) return

      db.run(
        'INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))',
        [sessionId, agentId, 'info', eventName, JSON.stringify(payload)]
      )
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
  '/hooks/pre-tool-use':   false, // high volume — IPC only, no DB write
  '/hooks/post-tool-use':  false,
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
  hookSecret = loadOrGenerateSecret(userDataPath)

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
        const payload = JSON.parse(raw) as Record<string, unknown>
        const url = req.url!

        if (url === '/hooks/stop') {
          handleStop(payload as StopPayload).catch(err =>
            console.error('[hookServer] handleStop error:', err)
          )
        } else if (url in LIFECYCLE_ROUTES) {
          const persistDb = LIFECYCLE_ROUTES[url]
          const eventName = url.replace('/hooks/', '').replace(/-./g, m => m[1].toUpperCase())
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

  server.listen(HOOK_PORT, () => {
    const addr = server.address()
    const port = typeof addr === 'object' && addr !== null ? addr.port : HOOK_PORT
    console.log(`[hookServer] Listening on 0.0.0.0:${port}`)
  })

  return server
}
