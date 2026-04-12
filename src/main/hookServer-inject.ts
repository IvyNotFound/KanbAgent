/**
 * Hook server — settings injection and WSL integration.
 *
 * Manages the hook auth secret and injects hook URLs + auth headers into
 * Claude Code settings.json files (both native Windows and WSL distros).
 *
 * Extracted from hookServer.ts (T1131) to keep file size under 400 lines.
 *
 * @module hookServer-inject
 */
import os from 'os'
import { join, dirname } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs'
import { randomBytes } from 'crypto'
import { execSync } from 'child_process'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HookEntry {
  type: string
  url?: string
  headers?: Record<string, string>
  command?: string
  timeout?: number
}

interface HookGroup {
  hooks?: HookEntry[]
}

interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Base port for the hook server. First port tried on startup. */
export const HOOK_PORT_BASE = 27182
/** Maximum port in the scan range (inclusive). 8 slots: 27182-27189. */
export const HOOK_PORT_MAX  = 27189
/** Backward-compatible alias — points to HOOK_PORT_BASE. */
export const HOOK_PORT = HOOK_PORT_BASE

/** Regex that matches any KanbAgent http hook URL (any port in 27182-27189). */
const KANBAGENT_URL_RE = /^http:\/\/[^/]+:2718[2-9]\/hooks\//

/** Returns true if `url` belongs to a KanbAgent http hook on `port` specifically. */
function isOwnPortUrl(url: string, port: number): boolean {
  return url.startsWith(`http://`) && url.includes(`:${port}/hooks/`)
}

/** Hook routes managed by KanbAgent — bootstrapped automatically if absent. */
export const HOOK_ROUTES: Record<string, string> = {
  Stop:          '/hooks/stop',
  SessionStart:  '/hooks/session-start',
  SubagentStart: '/hooks/subagent-start',
  SubagentStop:  '/hooks/subagent-stop',
  PreToolUse:          '/hooks/pre-tool-use',
  PostToolUse:         '/hooks/post-tool-use',
  InstructionsLoaded:  '/hooks/instructions-loaded',
  PermissionRequest:   '/hooks/permission-request',
}

/**
 * Hook events that require a longer timeout (seconds) because they block
 * Claude CLI until a response is returned. Other events use the default
 * (typically 5s, fire-and-forget).
 */
export const HOOK_TIMEOUTS: Record<string, number> = {
  PermissionRequest: 120,
}

// ── Hook auth secret ──────────────────────────────────────────────────────────

let hookSecret = ''

/** Returns the current hook auth secret (available after initHookSecret). */
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

/** Initialize the hook auth secret. Call once during server startup. */
export function initHookSecret(userDataPath?: string): void {
  hookSecret = loadOrGenerateSecret(userDataPath)
}

// ── Lockfile protocol (ADR-013) ───────────────────────────────────────────────

interface LockfileData {
  pid: number
  port: number
  startedAt: string
}

function getLockfilePath(userDataPath: string, port: number): string {
  return join(userDataPath, `hookserver-${port}.lock`)
}

/** Write a lockfile for this instance at startup. Best-effort. */
export function writeLockfile(userDataPath: string, port: number): void {
  const data: LockfileData = { pid: process.pid, port, startedAt: new Date().toISOString() }
  try {
    writeFileSync(getLockfilePath(userDataPath, port), JSON.stringify(data), { mode: 0o600 })
  } catch (err) {
    console.warn('[hookServer] Could not write lockfile:', err)
  }
}

/** Delete the lockfile for this instance on shutdown. Best-effort. */
export function deleteLockfile(userDataPath: string, port: number): void {
  try { unlinkSync(getLockfilePath(userDataPath, port)) } catch { /* ignore */ }
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

/**
 * Read all hookserver-*.lock files in userDataPath, check if each PID is alive.
 * Deletes stale lockfiles (dead PIDs).
 * Returns { alivePorts, stalePorts }.
 */
export function cleanupStaleLockfiles(userDataPath: string): { alivePorts: Set<number>; stalePorts: number[] } {
  const alivePorts = new Set<number>()
  const stalePorts: number[] = []

  let files: string[]
  try {
    files = readdirSync(userDataPath).filter(f => /^hookserver-\d+\.lock$/.test(f))
  } catch {
    return { alivePorts, stalePorts }
  }

  for (const file of files) {
    const lockPath = join(userDataPath, file)
    try {
      const raw = readFileSync(lockPath, 'utf-8')
      const data = JSON.parse(raw) as LockfileData
      if (isPidAlive(data.pid)) {
        alivePorts.add(data.port)
      } else {
        stalePorts.push(data.port)
        try { unlinkSync(lockPath) } catch { /* ignore */ }
        console.log(`[hookServer] Deleted stale lockfile: ${file} (PID ${data.pid} dead)`)
      }
    } catch {
      // Unreadable / corrupt lockfile — delete it
      try { unlinkSync(lockPath) } catch { /* ignore */ }
    }
  }

  return { alivePorts, stalePorts }
}

/**
 * Remove hook entries pointing to stale ports from settings.json.
 * Called at startup after cleanupStaleLockfiles identifies dead PIDs.
 */
export async function removeStaleHookEntries(settingsPath: string, stalePorts: number[]): Promise<void> {
  if (stalePorts.length === 0) return
  let settings: ClaudeSettings
  try {
    const raw = await readFile(settingsPath, 'utf-8')
    settings = JSON.parse(raw) as ClaudeSettings
  } catch {
    return // file missing or unreadable — nothing to clean
  }
  if (!settings.hooks) return

  let changed = false
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const filtered = groups.filter(g => {
      if (!Array.isArray(g.hooks)) return true
      // Drop this group if ALL its http hooks point to a stale port
      const hasStaleHttp = g.hooks.some(
        h => h.type === 'http' && h.url && stalePorts.some(p => isOwnPortUrl(h.url!, p))
      )
      return !hasStaleHttp
    })
    if (filtered.length !== groups.length) {
      settings.hooks[event] = filtered
      changed = true
    }
  }

  if (changed) {
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
    console.log('[hookServer] Removed stale hook entries from', settingsPath)
  }
}

/**
 * Inject the hook auth secret into a Claude Code settings.json file.
 * Adds `Authorization: Bearer <secret>` header to all http-type hooks.
 * Best-effort: silently skips if the file is missing or unreadable.
 */
export async function injectHookSecret(settingsPath: string): Promise<void> {
  try {
    const raw = await readFile(settingsPath, 'utf-8')
    const settings = JSON.parse(raw) as ClaudeSettings
    if (!settings.hooks) return
    let changed = false
    for (const eventGroups of Object.values(settings.hooks)) {
      for (const group of eventGroups) {
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
 * Inject hook URLs for this instance (identified by `port`) into settings.json.
 *
 * Additive (ADR-013): each instance manages only its own entries, identified by
 * the port number in the URL. Entries belonging to other KanbAgent instances
 * (ports 27182-27189) are never modified.
 *
 * - If settings.json is missing: creates it with all 8 managed hooks.
 * - For each hook event:
 *   - If our port's entry already exists: updates the IP if it changed.
 *   - If our port's entry is absent: adds a new group (alongside command hooks
 *     or other instances' http hooks — Claude Code fires all groups in parallel).
 * - Non-http hooks (type: command) are never modified.
 *
 * Best-effort: silently skips on unrecoverable errors.
 */
export async function injectHookUrls(settingsPath: string, ip: string, port: number): Promise<void> {
  let settings: ClaudeSettings = {}
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

  if (!settings.hooks) {
    settings.hooks = {}
  }

  for (const [event, path] of Object.entries(HOOK_ROUTES)) {
    const targetUrl = `http://${ip}:${port}${path}`

    if (!settings.hooks[event]) {
      // Event missing entirely — create with our entry
      const entry: HookEntry = { type: 'http', url: targetUrl }
      if (HOOK_TIMEOUTS[event]) entry.timeout = HOOK_TIMEOUTS[event]
      settings.hooks[event] = [{ hooks: [entry] }]
      changed = true
    } else {
      const groups = settings.hooks[event]
      // Find the group that already contains OUR port's http hook
      let foundOurGroup = false
      for (const group of groups) {
        if (!Array.isArray(group.hooks)) continue
        for (const hook of group.hooks) {
          if (hook.type === 'http' && hook.url && isOwnPortUrl(hook.url, port)) {
            // Our entry found — update URL if IP changed
            if (hook.url !== targetUrl) {
              hook.url = targetUrl
              changed = true
            }
            foundOurGroup = true
            break
          }
        }
        if (foundOurGroup) break
      }

      if (!foundOurGroup) {
        // No entry for our port yet — add a new group (additive)
        const entry: HookEntry = { type: 'http', url: targetUrl }
        if (HOOK_TIMEOUTS[event]) entry.timeout = HOOK_TIMEOUTS[event]
        groups.push({ hooks: [entry] })
        changed = true
      }
    }
  }

  if (changed || !fileExists) {
    if (!fileExists) {
      await mkdir(dirname(settingsPath), { recursive: true })
    }
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
    console.log(`[hookServer] Updated hook URLs (port ${port}) with IP:`, ip, '| created:', !fileExists)
  }
}

/**
 * Inject hook secret and URLs into a single WSL distro's ~/.claude/settings.json
 * by reading and writing via `wsl.exe -d <distro> -- bash -c "..."`.
 *
 * Bypasses the UNC path approach (\\wsl.localhost\...) which fails silently on
 * Windows when the distro filesystem is not fully mounted.
 */
async function injectIntoDistroViaWsl(distro: string, wslIp: string | null, port: number): Promise<void> {
  // Read current settings via wsl.exe (cat returns '{}' if file missing)
  let settings: ClaudeSettings
  try {
    const raw = execSync(
      `wsl.exe -d "${distro}" -- bash -c "cat ~/.claude/settings.json 2>/dev/null || echo '{}'"`,
      { timeout: 5000, encoding: 'utf-8' }
    ) as string
    settings = JSON.parse(raw.trim() || '{}') as ClaudeSettings
  } catch {
    settings = {}
  }

  let changed = false

  // Inject hook auth secret into existing http hooks
  if (settings.hooks && hookSecret) {
    for (const eventGroups of Object.values(settings.hooks)) {
      for (const group of eventGroups) {
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
  }

  // Inject hook URLs for the WSL gateway IP — additive (ADR-013)
  if (wslIp) {
    if (!settings.hooks) settings.hooks = {}
    const hooks = settings.hooks

    for (const [event, path] of Object.entries(HOOK_ROUTES)) {
      const targetUrl = `http://${wslIp}:${port}${path}`

      if (!hooks[event]) {
        const entry: HookEntry = { type: 'http', url: targetUrl }
        if (HOOK_TIMEOUTS[event]) entry.timeout = HOOK_TIMEOUTS[event]
        hooks[event] = [{ hooks: [entry] }]
        changed = true
      } else {
        const groups = hooks[event]
        let foundOurGroup = false
        for (const group of groups) {
          if (!Array.isArray(group.hooks)) continue
          for (const hook of group.hooks) {
            if (hook.type === 'http' && hook.url && isOwnPortUrl(hook.url, port)) {
              if (hook.url !== targetUrl) {
                hook.url = targetUrl
                changed = true
              }
              foundOurGroup = true
              break
            }
          }
          if (foundOurGroup) break
        }
        if (!foundOurGroup) {
          const entry: HookEntry = { type: 'http', url: targetUrl }
          if (HOOK_TIMEOUTS[event]) entry.timeout = HOOK_TIMEOUTS[event]
          groups.push({ hooks: [entry] })
          changed = true
        }
      }
    }
  }

  if (!changed) return

  const json = JSON.stringify(settings, null, 2) + '\n'
  execSync(
    `wsl.exe -d "${distro}" -- bash -c "mkdir -p ~/.claude && cat > ~/.claude/settings.json"`,
    { input: json, timeout: 5000, encoding: 'utf-8' }
  )
  console.log(`[hookServer] Injected hooks into WSL distro "${distro}" via wsl.exe`)
}

// Re-exports from extracted adapters module (backward compatibility)
export { generateHookStub, injectGeminiHooks, injectCodexHooks } from './hookServer-inject-adapters'

/**
 * Detect active WSL distros and inject hook secret + URLs into each one's
 * ~/.claude/settings.json via `wsl.exe -d <distro> -- bash -c "..."`.
 *
 * No-op on non-Windows or when wsl.exe is unavailable.
 * Logs errors for stopped/unreachable distros instead of silently skipping.
 */
export async function injectIntoWslDistros(wslIp: string | null, port: number): Promise<void> {
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
      await injectIntoDistroViaWsl(distro, wslIp, port)
    } catch (err) {
      console.error(`[hookServer] Failed to inject into WSL distro "${distro}":`, err)
    }
  }
}
