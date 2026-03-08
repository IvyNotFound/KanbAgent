/**
 * IPC handlers — multi-CLI detection (T1011)
 *
 * Detects installed coding-agent CLIs (claude, codex, gemini, opencode, aider, goose)
 * in the local environment and across WSL distros.
 *
 * Strategy:
 * - Windows local : execFile loop (where + --version per CLI)
 * - Linux/macOS   : bash one-liner (1 spawn for all CLIs)
 * - WSL distros   : bash login-shell one-liner per distro (CONCURRENCY=2)
 *
 * Single source of truth: CLI_REGISTRY — add a CLI by adding one entry here.
 *
 * @module ipc-cli-detect
 */

import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CliType, CliInstance } from '../../shared/cli-types'
import { enrichWindowsPath, getWslDistros, getWslExe } from './ipc-wsl'
import { toWslPath } from './utils/wsl'

const execPromise = promisify(execFile)

const WSL_TIMEOUT = 10_000
const LOCAL_TIMEOUT = 5_000
const CONCURRENCY = 2

/** Common CLI install paths in WSL/Linux — enriches PATH before .bashrc sourcing */
const WSL_KNOWN_PATHS = [
  '$HOME/go/bin',
  '$HOME/.local/bin',
  '$HOME/.cargo/bin',
  '$HOME/.npm-global/bin',
  '/snap/bin',
  '/home/linuxbrew/.linuxbrew/bin',
  '$HOME/.linuxbrew/bin',
]

// ── Detection cache ───────────────────────────────────────────────────────────
// Module-level cache: stores a single Promise<CliInstance[]> for the full
// (unfiltered) detection. Fire-and-forget at startup; IPC handler awaits it.

let detectionCache: Promise<CliInstance[]> | null = null

// ── Single source of truth ────────────────────────────────────────────────────
// To add a CLI: one line here, nothing else.

const CLI_REGISTRY: Record<CliType, { binary: string }> = {
  claude:   { binary: 'claude'   },
  codex:    { binary: 'codex'    },
  gemini:   { binary: 'gemini'   },
  opencode: { binary: 'opencode' },
  aider:    { binary: 'aider'    },
  goose:    { binary: 'goose'    },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract a version string from raw `--version` output.
 * Handles: "2.1.58", "2.1.58 (Claude Code)", "v0.1.2", "opencode v0.1.2".
 */
function parseVersion(raw: string): string {
  const line = raw.split('\n')[0].trim()
  const match = line.match(/v?(\d+\.\d+[\d.]*)/)
  return match ? match[1] : line.split(' ')[0]
}

function getEntries(filterClis?: CliType[]): [CliType, { binary: string }][] {
  const all = Object.entries(CLI_REGISTRY) as [CliType, { binary: string }][]
  return filterClis ? all.filter(([cli]) => filterClis.includes(cli)) : all
}

// ── Local detection ───────────────────────────────────────────────────────────

/**
 * Detect locally-installed CLIs.
 *
 * - Windows : execFile loop — `where <bin>` then `<bin> --version` per CLI
 * - Linux/macOS : bash one-liner — 1 spawn for all CLIs
 */
export async function detectLocalClis(filterClis?: CliType[], forceRefresh = false): Promise<CliInstance[]> {
  const entries = getEntries(filterClis)

  if (process.platform === 'win32') {
    await enrichWindowsPath(forceRefresh)
    const results: CliInstance[] = []
    for (const [cli, { binary }] of entries) {
      try {
        await execPromise('where', [binary], { timeout: LOCAL_TIMEOUT })
        const { stdout } = await execPromise(binary, ['--version'], {
          timeout: LOCAL_TIMEOUT,
          shell: true,
        })
        const raw = stdout.trim()
        if (!raw) continue
        results.push({
          cli,
          distro: 'local',
          version: parseVersion(raw),
          isDefault: true,
          type: 'local',
        })
      } catch { /* binary not in PATH */ }
    }
    return results
  }

  // Linux/macOS: single bash one-liner
  const binaries = entries.map(([, { binary }]) => binary).join(' ')
  const script = `for c in ${binaries}; do v=$($c --version 2>/dev/null | head -1); [ -n "$v" ] && echo "$c:$v"; done`
  try {
    const { stdout } = await execPromise('bash', ['-c', script], { timeout: LOCAL_TIMEOUT })
    const results: CliInstance[] = []
    for (const line of stdout.split('\n').map(l => l.trim()).filter(Boolean)) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const cli = line.slice(0, colonIdx) as CliType
      if (!(cli in CLI_REGISTRY)) continue
      if (filterClis && !filterClis.includes(cli)) continue
      const version = parseVersion(line.slice(colonIdx + 1))
      results.push({
        cli,
        distro: 'local',
        version,
        isDefault: true,
        type: 'local',
      })
    }
    return results
  } catch {
    return []
  }
}

// ── WSL detection ─────────────────────────────────────────────────────────────

/**
 * Parse CLI detection output lines into CliInstance objects.
 */
function parseDetectionOutput(
  raw: string,
  distro: string,
  isDefault: boolean,
  filterClis?: CliType[],
): CliInstance[] {
  const results: CliInstance[] = []
  const clean = raw.replace(/\0/g, '')
  for (const line of clean.split('\n').map(l => l.trim()).filter(Boolean)) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const cli = line.slice(0, colonIdx) as CliType
    if (!(cli in CLI_REGISTRY)) continue
    if (filterClis && !filterClis.includes(cli)) continue
    const version = parseVersion(line.slice(colonIdx + 1))
    results.push({ cli, distro, version, isDefault, type: 'wsl' })
  }
  return results
}

/**
 * Detect CLIs installed in a single WSL distro.
 *
 * Strategy: write a bash script to a temp file and run it via `bash -l <file>`.
 * This avoids argument-passing issues with `bash -lc <script>` through wsl.exe
 * on Windows (complex scripts with $(), for-do-done, && get mangled).
 *
 * The script sources `~/.bashrc` before probing binaries so that CLIs installed
 * via nvm/npm (which add to PATH only in ~/.bashrc) are detected correctly.
 *
 * The script ends with `exit 0` to prevent non-zero exit codes (from CLIs not
 * found) from causing execFile to reject and discard valid stdout output.
 */
export async function detectWslClis(
  distro: string,
  isDefault: boolean,
  filterClis?: CliType[],
): Promise<CliInstance[]> {
  const entries = getEntries(filterClis)
  const binaries = entries.map(([, { binary }]) => binary).join(' ')
  const pathDirs = WSL_KNOWN_PATHS.map(d => `"${d}"`).join(' ')
  const scriptContent = [
    '#!/bin/bash',
    `for d in ${pathDirs}; do`,
    '  [ -d "$d" ] && export PATH="$d:$PATH"',
    'done',
    '[ -f ~/.profile ] && . ~/.profile 2>/dev/null',
    '[ -f ~/.bashrc ] && . ~/.bashrc 2>/dev/null',
    '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" 2>/dev/null',
    `for c in ${binaries}; do`,
    '  v=$(timeout 3 $c --version 2>/dev/null | head -1)',
    '  [ -n "$v" ] && echo "$c:$v"',
    'done',
    'exit 0',
  ].join('\n')

  const scriptFile = join(tmpdir(), `cli-detect-${distro}-${Date.now()}.sh`)
  try {
    writeFileSync(scriptFile, scriptContent, 'utf-8')
    const scriptWslPath = toWslPath(scriptFile)

    const { stdout } = await execPromise(
      getWslExe(),
      ['-d', distro, '--', 'bash', '-l', scriptWslPath],
      { timeout: WSL_TIMEOUT },
    )
    return parseDetectionOutput(stdout, distro, isDefault, filterClis)
  } catch {
    return []
  } finally {
    try { unlinkSync(scriptFile) } catch { /* best-effort cleanup */ }
  }
}

// ── Warmup helpers ────────────────────────────────────────────────────────────

/**
 * Run full (unfiltered) CLI detection — local CLIs + WSL distros on Windows.
 */
async function runFullDetection(forceRefresh = false): Promise<CliInstance[]> {
  const platform = process.platform

  if (platform === 'linux' || platform === 'darwin') {
    try {
      return await detectLocalClis(undefined, forceRefresh)
    } catch {
      return []
    }
  }

  // Windows: local + WSL
  const results: CliInstance[] = []

  try {
    const local = await detectLocalClis(undefined, forceRefresh)
    results.push(...local)
  } catch { /* local detection failed — continue with WSL */ }

  try {
    const distros = await getWslDistros()
    for (let i = 0; i < distros.length; i += CONCURRENCY) {
      const batch = distros.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.all(
        batch.map(({ distro, isDefault }) => detectWslClis(distro, isDefault)),
      )
      results.push(...batchResults.flat())
    }
  } catch { /* WSL not available */ }

  return results
}

/**
 * Return the cached detection Promise, or start a new one.
 * The Promise always resolves (errors resolve to []).
 */
function getOrRunDetection(forceRefresh = false): Promise<CliInstance[]> {
  if (!detectionCache) {
    detectionCache = runFullDetection(forceRefresh).catch(() => [])
  }
  return detectionCache
}

/**
 * Fire CLI detection in the background so the cache is warm by the time
 * the user opens their first agent session. Called once at app startup.
 */
export function warmupCliDetection(): void {
  getOrRunDetection() // fire & forget — result is cached
}

/** Reset the detection cache. FOR TESTS ONLY. @internal */
export function _resetDetectionCacheForTest(): void {
  detectionCache = null
}

// ── IPC handler ───────────────────────────────────────────────────────────────

/**
 * Register the `wsl:get-cli-instances` IPC handler.
 *
 * Params: `{ clis?: CliType[]; forceRefresh?: boolean }` — optional filter and cache invalidation
 * Returns: `CliInstance[]` — local first, then WSL distros
 *
 * Uses the module-level detection cache populated by `warmupCliDetection()`.
 * If the warmup Promise is still in-flight, this awaits the same Promise
 * (no duplicate spawns). If called before warmup, starts detection on demand.
 * If `forceRefresh` is true, the cache is invalidated before detection runs.
 */
export function registerCliDetectHandlers(): void {
  ipcMain.handle(
    'wsl:get-cli-instances',
    async (_event, args?: { clis?: CliType[]; forceRefresh?: boolean }): Promise<CliInstance[]> => {
      if (args?.forceRefresh) detectionCache = null
      const filterClis = Array.isArray(args?.clis) ? args.clis : undefined
      const all = await getOrRunDetection(args?.forceRefresh ?? false)
      return filterClis ? all.filter(inst => filterClis.includes(inst.cli)) : all
    },
  )
}
