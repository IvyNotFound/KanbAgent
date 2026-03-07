/**
 * IPC handlers — WSL utilities (T721)
 *
 * Provides WSL distro detection with Claude Code installation check.
 * Extracted from the removed terminal.ts after T719 refactoring.
 *
 * @module ipc-wsl
 */

import { ipcMain, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'

const execPromise = promisify(execFile)

/**
 * Resolve the absolute path to wsl.exe via %SystemRoot% to avoid ENOENT
 * in packaged Electron apps where PATH may not include C:\Windows\System32
 * (same fix as T692 applied to detection code).
 */
export function getWslExe(): string {
  return process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'wsl.exe')
    : 'C:\\Windows\\System32\\wsl.exe'
}

const WSL_TIMEOUT = 10_000
const LOCAL_TIMEOUT = 5_000
const CONCURRENCY = 2

// Guard: enrich PATH only once per process (T1024)
let pathEnriched = false

/**
 * Enrich process.env.PATH with user registry PATH and known CLI install
 * locations. Windows only. Ensures CLI tools are findable when Electron is
 * launched from Start Menu / taskbar with a truncated inherited PATH.
 *
 * Reads HKCU\Environment\Path via PowerShell (same approach as
 * buildWindowsPS1Script in agent-stream-helpers.ts) then prepends known
 * install locations as a fallback.
 */
export async function enrichWindowsPath(): Promise<void> {
  if (pathEnriched) return
  pathEnriched = true

  try {
    const result = await execPromise(
      'powershell.exe',
      [
        '-NoProfile', '-Command',
        '[System.Environment]::ExpandEnvironmentVariables((Get-ItemProperty HKCU:\\Environment -ErrorAction SilentlyContinue).Path)',
      ],
      { timeout: LOCAL_TIMEOUT }
    )
    const regPath = result.stdout.trim()
    if (regPath) {
      process.env.PATH = regPath + ';' + (process.env.PATH ?? '')
    }
  } catch { /* registry not accessible — skip */ }

  // Prepend known install locations (same set as buildWindowsPS1Script)
  const u = process.env.USERPROFILE ?? ''
  const ap = process.env.APPDATA ?? ''
  const la = process.env.LOCALAPPDATA ?? ''
  const known = [
    `${u}\\.local\\bin`,
    `${ap}\\npm`,
    `${la}\\Programs\\claude`,
    `${la}\\AnthropicClaude\\bin`,
    `${la}\\npm`,
    `${la}\\Programs`,
  ].join(';')
  process.env.PATH = known + ';' + (process.env.PATH ?? '')
}

/**
 * Represents a WSL distro or local installation with Claude Code installed.
 *
 * @property distro    - WSL distribution name (e.g. `Ubuntu`, `Debian`) or `"local"` for native installs
 * @property version   - Claude Code version string (e.g. `2.1.58`)
 * @property isDefault - Whether this distro is marked as default in `wsl.exe -l`
 * @property type      - `"wsl"` for WSL distro instances, `"local"` for native installs (T774)
 */
export interface ClaudeInstance {
  distro: string
  version: string
  isDefault: boolean
  type: 'wsl' | 'local'
}

/**
 * Detect a locally-installed Claude Code instance (Linux, macOS, or Windows native).
 *
 * - Uses `which claude` on Linux/macOS, `where claude` on Windows
 * - Returns null if Claude Code is not found in PATH
 *
 * @returns ClaudeInstance with type `"local"`, or null if not found
 */
export async function detectLocalInstance(): Promise<ClaudeInstance | null> {
  const platform = process.platform
  const whichCmd = platform === 'win32' ? 'where' : 'which'

  if (platform === 'win32') {
    await enrichWindowsPath()
  }

  try {
    await execPromise(whichCmd, ['claude'], { timeout: LOCAL_TIMEOUT })

    const versionResult = await execPromise(
      'claude',
      ['--version'],
      { timeout: LOCAL_TIMEOUT, shell: platform === 'win32' }
    )
    const rawVersion = versionResult.stdout.trim()
    if (!rawVersion) return null
    const version = rawVersion.split(' ')[0]

    return { distro: 'local', version, isDefault: true, type: 'local' }
  } catch {
    return null
  }
}

/**
 * List WSL distros (non-docker) by parsing `wsl.exe -l --verbose`.
 * Exported for reuse by ipc-cli-detect.ts.
 *
 * @returns Array of { distro, isDefault } entries, or [] if wsl.exe fails
 */
export async function getWslDistros(): Promise<{ distro: string; isDefault: boolean }[]> {
  const listResult = await execPromise(getWslExe(), ['-l', '--verbose'])
  const listOutput = listResult.stdout.replace(/\0/g, '')
  const lines = listOutput.split('\n').map(l => l.trim().replace(/\r/g, ''))
  const entries: { distro: string; isDefault: boolean }[] = []
  for (const line of lines) {
    if (!line || /^NAME\s+STATE/i.test(line)) continue
    const isDefault = line.startsWith('*')
    const cleaned = line.replace(/^\*\s*/, '')
    const distro = cleaned.split(/\s+/)[0]
    if (distro && !distro.toLowerCase().includes('docker')) {
      entries.push({ distro, isDefault })
    }
  }
  return entries
}

/**
 * Detect all WSL distros that have Claude Code installed.
 *
 * Detection strategy:
 * 1. List distros via `wsl.exe -l --verbose` (marks default with `*`)
 * 2. For each non-docker distro, run `bash -lc 'claude --version'` to check availability
 *
 * Note: wsl.exe outputs UTF-16LE on Windows — null bytes must be stripped.
 *
 * @returns Array of WSL ClaudeInstance objects (type `"wsl"`)
 */
async function detectWslInstances(): Promise<ClaudeInstance[]> {
  // Step 1: get list of distros and find which one is the default
  const distroEntries = await getWslDistros()

  if (distroEntries.length === 0) return []

  // Step 2: check each distro for claude — max 2 concurrent to avoid overloading WSL
  const results: (ClaudeInstance | null)[] = []
  for (let i = 0; i < distroEntries.length; i += CONCURRENCY) {
    const batch = distroEntries.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(batch.map(async ({ distro, isDefault }) => {
      try {
        const versionResult = await execPromise(
          getWslExe(),
          ['-d', distro, '--', 'bash', '-lc', 'claude --version 2>/dev/null'],
          { timeout: WSL_TIMEOUT }
        )
        const rawVersion = versionResult.stdout.replace(/\0/g, '').trim()
        if (!rawVersion) return null
        // Parse "2.1.58 (Claude Code)" → "2.1.58"
        const version = rawVersion.split(' ')[0]

        return { distro, version, isDefault, type: 'wsl' as const }
      } catch {
        // Claude not installed in this distro, or timed out
        return null
      }
    }))
    results.push(...batchResults)
  }

  // Filter out nulls and sort: default distro first
  return results
    .filter((r): r is ClaudeInstance => r !== null)
    .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
}

/**
 * Open an external WSL terminal window.
 * Strategy: try Windows Terminal (`wt.exe wsl`) first, fall back to `wsl://` URI, then `wsl.exe`.
 */
async function openWslTerminalWindow(): Promise<{ success: boolean; error?: string }> {
  // 1. Try Windows Terminal (preferred — opens in a proper tabbed window)
  try {
    const child = spawn('wt.exe', ['wsl'], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    return { success: true }
  } catch { /* Windows Terminal not available */ }

  // 2. Fallback: shell.openExternal with wsl:// URI (registered by WSL on Windows 11)
  try {
    await shell.openExternal('wsl://')
    return { success: true }
  } catch { /* URI handler not registered */ }

  // 3. Last resort: spawn wsl.exe directly (opens default distro in conhost)
  try {
    const child = spawn(getWslExe(), [], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

/**
 * Register all WSL IPC handlers on `ipcMain`.
 *
 * Handlers registered:
 * - `wsl:getClaudeInstances` — detect Claude Code instances (local + WSL depending on platform)
 * - `wsl:openTerminal`       — open an external WSL terminal window
 *
 * Platform behavior (T774):
 * - Linux / macOS : local instance only (no WSL)
 * - Windows       : local instance (if any) + all WSL distros with Claude Code
 *
 * @returns void
 */
export function registerWslHandlers(): void {
  /**
   * Detect all Claude Code instances available on the current platform.
   * Returns a ClaudeInstance array — local instance first, then WSL distros (default distro first).
   */
  ipcMain.handle('wsl:getClaudeInstances', async (): Promise<ClaudeInstance[]> => {
    const platform = process.platform

    // On Linux/macOS, Electron runs natively — only detect local install, never call wsl.exe
    if (platform === 'linux' || platform === 'darwin') {
      try {
        const local = await detectLocalInstance()
        return local ? [local] : []
      } catch {
        return []
      }
    }

    // Windows: detect local Claude Code + all WSL distros
    const results: ClaudeInstance[] = []

    try {
      const local = await detectLocalInstance()
      if (local) results.push(local)
    } catch { /* local detection failed — continue with WSL */ }

    try {
      const wslInstances = await detectWslInstances()
      results.push(...wslInstances)
    } catch { /* WSL not available */ }

    return results
  })

  /** Open an external WSL terminal window (wt.exe → wsl:// → wsl.exe). */
  ipcMain.handle('wsl:openTerminal', async (): Promise<{ success: boolean; error?: string }> => {
    return openWslTerminalWindow()
  })
}
