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

const LOCAL_TIMEOUT = 5_000

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
    const parts = cleaned.split(/\s+/)
    const distro = parts[0]
    const state = parts[1]?.toLowerCase()
    if (distro && !distro.toLowerCase().includes('docker') && (state === 'running' || state === 'stopped')) {
      entries.push({ distro, isDefault })
    }
  }
  return entries
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
 * - `wsl:openTerminal` — open an external WSL terminal window
 *
 * @returns void
 */
export function registerWslHandlers(): void {
  /** Open an external WSL terminal window (wt.exe → wsl:// → wsl.exe). */
  ipcMain.handle('wsl:openTerminal', async (): Promise<{ success: boolean; error?: string }> => {
    return openWslTerminalWindow()
  })
}
