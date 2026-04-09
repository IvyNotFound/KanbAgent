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
import { readFileSync, writeFileSync } from 'fs'
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

export const HOOK_PORT = 27182

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
 * Inject the detected Windows/WSL gateway IP into all http-type hook URLs
 * in a Claude Code settings.json file.
 *
 * - If settings.json is missing: creates it with all 7 managed hooks.
 * - If settings.json exists but `hooks` is absent: adds the full hooks structure.
 * - If `hooks` is present but some events are missing: adds only the missing ones.
 * - Always updates the host of existing http hook URLs to `ip:HOOK_PORT`.
 * - Non-http hooks (type: command) are never modified.
 *
 * Best-effort: silently skips on unrecoverable errors.
 */
export async function injectHookUrls(settingsPath: string, ip: string): Promise<void> {
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

  // Bootstrap hooks object if absent
  if (!settings.hooks) {
    settings.hooks = {}
  }

  // Add managed hook events that are missing, or inject http hook into existing events
  for (const [event, path] of Object.entries(HOOK_ROUTES)) {
    if (!settings.hooks[event]) {
      const entry: HookEntry = { type: 'http', url: `http://${ip}:${HOOK_PORT}${path}` }
      if (HOOK_TIMEOUTS[event]) entry.timeout = HOOK_TIMEOUTS[event]
      settings.hooks[event] = [{ hooks: [entry] }]
      changed = true
    } else {
      // Event exists (e.g. peon-ping command hooks) — add http hook if not already present
      const groups = settings.hooks[event]
      const hasHttp = groups.some(g => Array.isArray(g.hooks) && g.hooks.some(h => h.type === 'http'))
      if (!hasHttp) {
        groups.push({ hooks: [{ type: 'http', url: `http://${ip}:${HOOK_PORT}${path}` }] })
        changed = true
      }
    }
  }

  // Update host in existing http hook URLs
  for (const eventGroups of Object.values(settings.hooks)) {
    for (const group of eventGroups) {
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
 * Inject hook secret and URLs into a single WSL distro's ~/.claude/settings.json
 * by reading and writing via `wsl.exe -d <distro> -- bash -c "..."`.
 *
 * Bypasses the UNC path approach (\\wsl.localhost\...) which fails silently on
 * Windows when the distro filesystem is not fully mounted.
 */
async function injectIntoDistroViaWsl(distro: string, wslIp: string | null): Promise<void> {
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

  // Inject hook URLs for the WSL gateway IP
  if (wslIp) {
    if (!settings.hooks) settings.hooks = {}
    const hooks = settings.hooks

    for (const [event, path] of Object.entries(HOOK_ROUTES)) {
      if (!hooks[event]) {
        const entry: HookEntry = { type: 'http', url: `http://${wslIp}:${HOOK_PORT}${path}` }
        if (HOOK_TIMEOUTS[event]) entry.timeout = HOOK_TIMEOUTS[event]
        hooks[event] = [{ hooks: [entry] }]
        changed = true
      } else {
        const groups = hooks[event]
        const hasHttp = groups.some(g => Array.isArray(g.hooks) && g.hooks.some(h => h.type === 'http'))
        if (!hasHttp) {
          const entry: HookEntry = { type: 'http', url: `http://${wslIp}:${HOOK_PORT}${path}` }
          if (HOOK_TIMEOUTS[event]) entry.timeout = HOOK_TIMEOUTS[event]
          groups.push({ hooks: [entry] })
          changed = true
        }
      }
    }

    // Update host in existing http hook URLs
    for (const eventGroups of Object.values(hooks)) {
      for (const group of eventGroups) {
        if (!Array.isArray(group.hooks)) continue
        for (const hook of group.hooks) {
          if (hook.type === 'http' && hook.url) {
            const updated = hook.url.replace(
              /^http:\/\/[^/]+\/hooks\//,
              `http://${wslIp}:${HOOK_PORT}/hooks/`
            )
            if (updated !== hook.url) {
              hook.url = updated
              changed = true
            }
          }
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

// ── Gemini / Codex hook injection ────────────────────────────────────────────

/**
 * Gemini CLI hook events → KanbAgent hook route mapping.
 * Gemini uses these event names in ~/.gemini/settings.json.
 */
const GEMINI_HOOK_EVENTS: Array<{ event: string; route: string }> = [
  { event: 'SessionStart', route: '/hooks/session-start' },
  { event: 'SessionEnd',   route: '/hooks/stop' },
  { event: 'BeforeTool',   route: '/hooks/pre-tool-use' },
  { event: 'AfterTool',    route: '/hooks/post-tool-use' },
]

/**
 * Codex CLI hook events → KanbAgent hook route mapping.
 * Codex uses these event names in ~/.codex/hooks.json.
 * NOTE: hooks.json format is based on available doc hints — verify against
 * https://developers.openai.com/codex/hooks if it changes between CLI versions.
 */
const CODEX_HOOK_EVENTS: Array<{ event: string; route: string }> = [
  { event: 'SessionStart', route: '/hooks/session-start' },
  { event: 'Stop',         route: '/hooks/stop' },
  { event: 'PreToolUse',   route: '/hooks/pre-tool-use' },
  { event: 'PostToolUse',  route: '/hooks/post-tool-use' },
]

/**
 * Generate a platform-appropriate shell stub script that reads JSON from
 * stdin and POSTs it to the KanbAgent hookServer.
 *
 * On Windows: generates a .cmd file using curl (built-in since Windows 10 1803).
 * On Unix/WSL: generates a .sh file using curl.
 *
 * Always regenerated on startup so the embedded IP/secret stays current.
 * The output directory is created if missing.
 */
export async function generateHookStub(
  outputPath: string,
  ip: string,
  port: number,
  route: string,
  secret: string
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true })
  let script: string
  if (process.platform === 'win32') {
    // Windows-native: curl is available since Windows 10 build 1803.
    script = [
      '@echo off',
      `curl -s -X POST "http://${ip}:${port}${route}" ^`,
      `  -H "Authorization: Bearer ${secret}" ^`,
      '  -H "Content-Type: application/json" ^',
      '  --data-binary @-',
      ''
    ].join('\r\n')
  } else {
    script = [
      '#!/bin/sh',
      '# Generated by KanbAgent — do not edit',
      `curl -s -X POST "http://${ip}:${port}${route}" \\`,
      `  -H "Authorization: Bearer ${secret}" \\`,
      '  -H "Content-Type: application/json" \\',
      '  -d @-',
      ''
    ].join('\n')
  }
  await writeFile(outputPath, script, { mode: 0o755 })
}

/**
 * Inject Gemini CLI lifecycle hooks into the given settings.json path
 * (typically ~/.gemini/settings.json).
 *
 * Uses command-type hooks with shell stubs stored in `stubsDir`.
 * The JSON structure is identical to Claude Code settings.json (hook groups).
 * Idempotent: does not add duplicate command entries for the same stub path.
 * Always regenerates stub scripts to embed the current IP/secret.
 *
 * Best-effort: silently skips on unrecoverable read errors.
 */
export async function injectGeminiHooks(
  settingsPath: string,
  ip: string,
  secret: string,
  stubsDir: string
): Promise<void> {
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
      console.warn('[hookServer] Could not read Gemini settings:', err)
      return
    }
  }

  let changed = false
  if (!settings.hooks) {
    settings.hooks = {}
  }

  const ext = process.platform === 'win32' ? '.cmd' : '.sh'

  for (const { event, route } of GEMINI_HOOK_EVENTS) {
    const stubPath = join(stubsDir, `gemini-${event.toLowerCase()}${ext}`)
    // Always regenerate stub so IP/secret stay current
    await generateHookStub(stubPath, ip, HOOK_PORT, route, secret).catch(
      (err) => console.warn(`[hookServer] Could not generate Gemini stub for ${event}:`, err)
    )

    if (!settings.hooks![event]) {
      settings.hooks![event] = [{ hooks: [{ type: 'command', command: stubPath, timeout: 5000 }] }]
      changed = true
    } else {
      const groups = settings.hooks![event]
      const hasOurCommand = groups.some(
        (g) => Array.isArray(g.hooks) && g.hooks.some((h) => h.type === 'command' && h.command === stubPath)
      )
      if (!hasOurCommand) {
        groups.push({ hooks: [{ type: 'command', command: stubPath, timeout: 5000 }] })
        changed = true
      }
    }
  }

  if (changed || !fileExists) {
    if (!fileExists) {
      await mkdir(dirname(settingsPath), { recursive: true })
    }
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
    console.log('[hookServer] Updated Gemini hooks:', settingsPath, '| created:', !fileExists)
  }
}

/**
 * Inject Codex CLI lifecycle hooks into the given hooks.json path
 * (typically ~/.codex/hooks.json).
 *
 * No-op on Windows native: Codex hooks are disabled on Windows (WSL only).
 * Idempotent: does not overwrite existing entries pointing to the same stub.
 * Always regenerates stub scripts to embed the current IP/secret.
 *
 * hooks.json format: flat JSON object mapping event names to command paths.
 * Verify format against https://developers.openai.com/codex/hooks if needed.
 *
 * Best-effort: silently skips on unrecoverable read errors.
 */
export async function injectCodexHooks(
  hooksPath: string,
  ip: string,
  secret: string,
  stubsDir: string
): Promise<void> {
  // Codex hooks are WSL/Linux only — skip on Windows native
  if (process.platform === 'win32') return

  let hooks: Record<string, string> = {}
  let fileExists = true

  try {
    const raw = await readFile(hooksPath, 'utf-8')
    hooks = JSON.parse(raw)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') {
      fileExists = false
    } else {
      console.warn('[hookServer] Could not read Codex hooks:', err)
      return
    }
  }

  let changed = false

  for (const { event, route } of CODEX_HOOK_EVENTS) {
    const stubPath = join(stubsDir, `codex-${event.toLowerCase()}.sh`)
    // Always regenerate stub so IP/secret stay current
    await generateHookStub(stubPath, ip, HOOK_PORT, route, secret).catch(
      (err) => console.warn(`[hookServer] Could not generate Codex stub for ${event}:`, err)
    )

    if (hooks[event] !== stubPath) {
      hooks[event] = stubPath
      changed = true
    }
  }

  if (changed || !fileExists) {
    if (!fileExists) {
      await mkdir(dirname(hooksPath), { recursive: true })
    }
    await writeFile(hooksPath, JSON.stringify(hooks, null, 2) + '\n', 'utf-8')
    console.log('[hookServer] Updated Codex hooks:', hooksPath, '| created:', !fileExists)
  }
}

/**
 * Detect active WSL distros and inject hook secret + URLs into each one's
 * ~/.claude/settings.json via `wsl.exe -d <distro> -- bash -c "..."`.
 *
 * No-op on non-Windows or when wsl.exe is unavailable.
 * Logs errors for stopped/unreachable distros instead of silently skipping.
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
      await injectIntoDistroViaWsl(distro, wslIp)
    } catch (err) {
      console.error(`[hookServer] Failed to inject into WSL distro "${distro}":`, err)
    }
  }
}
