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

const execPromise = promisify(execFile)

const WSL_TIMEOUT = 10_000
const CONCURRENCY = 2

export interface ClaudeInstance {
  distro: string
  version: string
  isDefault: boolean
  profiles: string[]
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
    const child = spawn('wsl.exe', [], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

/** Register all WSL IPC handlers. */
export function registerWslHandlers(): void {
  /**
   * Detect all WSL distros that have Claude Code installed.
   * Returns a ClaudeInstance array sorted with the default distro first.
   * Used by LaunchSessionModal and useLaunchSession composable.
   *
   * Detection strategy:
   * 1. List distros via `wsl.exe -l --verbose` (marks default with `*`)
   * 2. For each non-docker distro, run `bash -lc 'claude --version'` to check availability
   * 3. Also scan ~/bin/ for claude-* wrapper scripts (custom profiles)
   *
   * Note: wsl.exe outputs UTF-16LE on Windows — null bytes must be stripped.
   */
  ipcMain.handle('wsl:getClaudeInstances', async (): Promise<ClaudeInstance[]> => {
    try {
      // Step 1: get list of distros and find which one is the default
      const listResult = await execPromise('wsl.exe', ['-l', '--verbose'])
      // Strip UTF-16 null bytes (wsl.exe output is UTF-16LE → node reads as UTF-8 + nulls)
      const listOutput = listResult.stdout.replace(/\0/g, '')
      const lines = listOutput.split('\n').map(l => l.trim().replace(/\r/g, ''))

      // Parse distro names and detect the default (marked with *)
      // Header line is "NAME STATE VERSION" — skip it
      const distroEntries: { distro: string; isDefault: boolean }[] = []
      for (const line of lines) {
        if (!line || /^NAME\s+STATE/i.test(line)) continue
        const isDefault = line.startsWith('*')
        const cleaned = line.replace(/^\*\s*/, '')
        const distro = cleaned.split(/\s+/)[0]
        if (distro && !distro.toLowerCase().includes('docker')) {
          distroEntries.push({ distro, isDefault })
        }
      }

      if (distroEntries.length === 0) return []

      // Step 2: check each distro for claude — max 2 concurrent to avoid overloading WSL
      const results: (ClaudeInstance | null)[] = []
      for (let i = 0; i < distroEntries.length; i += CONCURRENCY) {
        const batch = distroEntries.slice(i, i + CONCURRENCY)
        const batchResults = await Promise.all(batch.map(async ({ distro, isDefault }) => {
          try {
            const versionResult = await execPromise(
              'wsl.exe',
              ['-d', distro, '--', 'bash', '-lc', 'claude --version 2>/dev/null'],
              { timeout: WSL_TIMEOUT }
            )
            const rawVersion = versionResult.stdout.replace(/\0/g, '').trim()
            if (!rawVersion) return null
            // Parse "2.1.58 (Claude Code)" → "2.1.58"
            const version = rawVersion.split(' ')[0]

            // Step 3: scan ~/bin/ for claude-* wrapper scripts
            let profiles: string[] = ['claude']
            try {
              const binResult = await execPromise(
                'wsl.exe',
                ['-d', distro, '--', 'bash', '-lc', 'ls ~/bin/ 2>/dev/null'],
                { timeout: WSL_TIMEOUT }
              )
              const scripts = binResult.stdout
                .replace(/\0/g, '')
                .split('\n')
                .map(f => f.trim())
                .filter(f => /^claude(-[a-z0-9-]+)?$/.test(f))
                .sort()
              profiles = ['claude', ...scripts.filter(s => s !== 'claude')]
            } catch { /* ~/bin/ may not exist — default profile only */ }

            return { distro, version, isDefault, profiles }
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
    } catch {
      // WSL not available or unexpected error
      return []
    }
  })

  /** Open an external WSL terminal window (wt.exe → wsl:// → wsl.exe). */
  ipcMain.handle('wsl:openTerminal', async (): Promise<{ success: boolean; error?: string }> => {
    return openWslTerminalWindow()
  })
}
