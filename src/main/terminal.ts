/**
 * Terminal management for agent-viewer.
 *
 * Handles WSL PTY sessions via node-pty, including:
 * - Creating PTY processes (plain bash or Claude Code agent sessions)
 * - Session resume via `--resume <conv_id>`
 * - Graceful kill with Ctrl+C for agent sessions
 * - Crash recovery with stored launch params
 * - WSL memory monitoring (periodic `free -m` checks)
 * - Conversation ID detection from Claude Code startup banner
 *
 * @module terminal
 */
import { ipcMain, app, BrowserWindow } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { execFile } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'

const execPromise = promisify(execFile)

const ptys = new Map<string, IPty>()

// Track which PTY IDs belong to each WebContents (by webContents.id)
// Allows automatic cleanup when a renderer is destroyed (window close, crash)
const webContentsPtys = new Map<number, Set<string>>()

let nextId = 1

// Regex pour valider les noms de profils Claude (claude ou claude-<suffix>)
const CLAUDE_CMD_REGEX = /^claude(-[a-z0-9-]+)?$/

// Regex to detect a Claude Code session/conversation UUID in PTY output.
// Claude Code CLI displays the session ID at startup in formats like:
//   "Session ID: <uuid>" or just as a standalone UUID in a status line.
// We match any UUID v4 pattern (8-4-4-4-12 hex) appearing after common labels.
const CONV_ID_REGEX = /(?:session(?:\s+id)?|conversation(?:\s+id)?|resuming)[:\s]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

// Validate a string is a well-formed UUID (8-4-4-4-12)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Track which PTY IDs were launched with a systemPrompt (agent session)
// Used by gracefulKillPty to send Ctrl+C before killing
const agentPtys = new Set<string>()

// T370: Track pending kill timeouts to cancel on double call
const killTimeouts = new Map<string, ReturnType<typeof setTimeout>[]>()

// ── T279: Store launch params per PTY for crash recovery ─────────────────
interface PtyLaunchParams {
  cols: number
  rows: number
  projectPath?: string
  wslDistro?: string
  systemPrompt?: string
  userPrompt?: string
  thinkingMode?: string
  claudeCommand?: string
  convId?: string
  detectedConvId?: string  // Captured during the session (for --resume)
}
const ptyLaunchParams = new Map<string, PtyLaunchParams>()

// ── T279: WSL memory monitoring ──────────────────────────────────────────
const MEMORY_WARNING_THRESHOLD = 0.80    // Warn at 80% usage
const MEMORY_CRITICAL_THRESHOLD = 0.85   // T328: Auto release at 85% (available < 15%)
const MEMORY_RELEASE_COOLDOWN_MS = 60_000 // T328: Min 60s between auto releases
let memoryCheckTimer: ReturnType<typeof setInterval> | null = null
let lastAutoReleaseAt = 0

// T328: Adaptive monitoring intervals based on memory pressure
const INTERVAL_NORMAL = 60_000   // available > 30% → 60s
const INTERVAL_WARNING = 15_000  // available 15-30% → 15s
const INTERVAL_CRITICAL = 5_000  // available < 15% → 5s

// T328: WSL drop_caches capability
let dropCachesAvailable: boolean | null = null // null = not yet checked

async function checkDropCachesCapability(): Promise<boolean> {
  try {
    // Test if sudoers NOPASSWD is configured specifically for tee /proc/sys/vm/drop_caches
    // Executes echo 1 | sudo -n tee to verify NOPASSWD permission on tee specifically
    // — avoids false negatives for users who only have NOPASSWD on tee (not on all commands)
    await execPromise('wsl.exe', ['--', 'bash', '-c', 'echo 1 | sudo -n tee /proc/sys/vm/drop_caches > /dev/null'], { timeout: 5000 })
    dropCachesAvailable = true
  } catch {
    dropCachesAvailable = false
  }
  return dropCachesAvailable
}

/**
 * T328: Release WSL memory — sync flush + optional drop_caches.
 * @returns {{ synced: boolean, dropped: boolean, error?: string }}
 */
async function releaseWslMemory(): Promise<{ synced: boolean; dropped: boolean; error?: string }> {
  let synced = false
  let dropped = false

  try {
    // sync is always possible (no sudo needed)
    await execPromise('wsl.exe', ['--', 'sync'], { timeout: 10_000 })
    synced = true
  } catch (err) {
    return { synced: false, dropped: false, error: `sync failed: ${err}` }
  }

  if (dropCachesAvailable) {
    try {
      await execPromise('wsl.exe', ['--', 'bash', '-c', 'echo 3 | sudo -n tee /proc/sys/vm/drop_caches'], { timeout: 10_000 })
      dropped = true
    } catch (err) {
      return { synced, dropped: false, error: `drop_caches failed: ${err}` }
    }
  }

  return { synced, dropped }
}

/**
 * Force-kills a PTY by ID and cleans up tracking maps.
 * @param id - PTY session identifier.
 */
function killPty(id: string): void {
  const pty = ptys.get(id)
  if (!pty) return
  try { pty.kill() } catch { /* already dead */ }
  ptys.delete(id)
  agentPtys.delete(id)
  // Keep ptyLaunchParams for potential relaunch — cleaned up by terminal:dismissCrash
}

/**
 * Parse `free -m` output to extract memory pressure.
 * Uses the "available" column (real pressure) instead of "used" (includes reclaimable buff/cache).
 * Returns { usedRatio, totalMB, usedMB, availableMB } or null on parse failure.
 */
function parseFreeMOutput(stdout: string): { usedRatio: number; totalMB: number; usedMB: number; availableMB: number } | null {
  // Typical output:
  //               total        used        free      shared  buff/cache   available
  // Mem:           7951        3200        2100          50        2651        4500
  const memLine = stdout.split('\n').find(l => l.startsWith('Mem:'))
  if (!memLine) return null
  const parts = memLine.split(/\s+/)
  const totalMB = parseInt(parts[1], 10)
  // T328: Use "available" (col 6) for real memory pressure — "used" includes reclaimable buff/cache
  const availableMB = parts.length >= 7 ? parseInt(parts[6], 10) : NaN
  if (isNaN(totalMB) || totalMB === 0) return null
  if (!isNaN(availableMB)) {
    const usedMB = totalMB - availableMB
    return { usedRatio: usedMB / totalMB, totalMB, usedMB, availableMB }
  }
  // Fallback: older free(1) without available column
  const usedMB = parseInt(parts[2], 10)
  if (isNaN(usedMB)) return null
  return { usedRatio: usedMB / totalMB, totalMB, usedMB, availableMB: totalMB - usedMB }
}

/**
 * Graceful kill for WSL PTY sessions.
 * Sends Ctrl+C x2 to interrupt Claude, then 'exit' to close bash,
 * then force kills after a timeout if still alive.
 * This ensures child processes (claude, bash) inside WSL are also terminated.
 */
function gracefulKillPty(id: string): void {
  const pty = ptys.get(id)
  if (!pty) return

  // T370: Cancel any pending kill timeouts from a previous call
  const pending = killTimeouts.get(id)
  if (pending) {
    for (const t of pending) clearTimeout(t)
    killTimeouts.delete(id)
  }

  const isAgentSession = agentPtys.has(id)

  if (isAgentSession) {
    const timers: ReturnType<typeof setTimeout>[] = []

    // Step 1: Send Ctrl+C x2 to interrupt Claude
    pty.write('\x03\x03')

    // Step 2: After 100ms, send 'exit' to close bash
    timers.push(setTimeout(() => {
      const currentPty = ptys.get(id)
      if (currentPty) {
        currentPty.write('exit\r')
      }
    }, 100))

    // Step 3: Force kill after 300ms if still alive
    timers.push(setTimeout(() => {
      killTimeouts.delete(id)
      killPty(id)
    }, 300))

    killTimeouts.set(id, timers)
  } else {
    // Regular bash session - just kill immediately
    killPty(id)
  }
}

/** Kills all active PTY sessions. Called on app quit. */
function killAllPtys(): void {
  for (const id of [...ptys.keys()]) {
    gracefulKillPty(id)
  }
  webContentsPtys.clear()
  ptyLaunchParams.clear()
  stopMemoryMonitoring()
}

// ── T279+T328: Memory monitoring helpers ─────────────────────────────────
let currentInterval = INTERVAL_NORMAL

/**
 * Starts adaptive WSL memory monitoring.
 * Broadcasts `terminal:memoryStatus` to all renderer windows.
 * Auto-triggers memory release when pressure is critical.
 */
function startMemoryMonitoring(_webContentsId: number): void {
  if (memoryCheckTimer) return  // Already running
  if (ptys.size === 0) return   // No active PTYs — skip

  // T328: Check drop_caches capability on first PTY start
  if (dropCachesAvailable === null) checkDropCachesCapability()

  scheduleMemoryCheck()
}

function scheduleMemoryCheck(): void {
  if (memoryCheckTimer) clearInterval(memoryCheckTimer)
  memoryCheckTimer = setInterval(doMemoryCheck, currentInterval)
}

let memoryCheckRunning = false
async function doMemoryCheck(): Promise<void> {
  if (ptys.size === 0) { stopMemoryMonitoring(); return }
  if (memoryCheckRunning) return // Guard against re-entrance when execPromise is slow
  memoryCheckRunning = true
  try {
    const { stdout } = await execPromise('wsl.exe', ['--', 'free', '-m'])
    const mem = parseFreeMOutput(stdout.replace(/\0/g, ''))
    if (!mem) return

    const availableRatio = mem.availableMB / mem.totalMB

    // T328: Adaptive interval based on memory pressure
    let newInterval: number
    if (availableRatio < 0.15) {
      newInterval = INTERVAL_CRITICAL
    } else if (availableRatio < 0.30) {
      newInterval = INTERVAL_WARNING
    } else {
      newInterval = INTERVAL_NORMAL
    }
    if (newInterval !== currentInterval) {
      currentInterval = newInterval
      scheduleMemoryCheck()
    }

    // T328: Auto release when critical + cooldown elapsed
    if (mem.usedRatio >= MEMORY_CRITICAL_THRESHOLD) {
      const now = Date.now()
      if (now - lastAutoReleaseAt >= MEMORY_RELEASE_COOLDOWN_MS) {
        lastAutoReleaseAt = now
        releaseWslMemory().catch(() => { /* ignore */ })
      }
    }

    // Broadcast to all active WebContents
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('terminal:memoryStatus', {
          usedMB: mem.usedMB,
          totalMB: mem.totalMB,
          availableMB: mem.availableMB,
          usedRatio: Math.round(mem.usedRatio * 100),
          warning: mem.usedRatio >= MEMORY_WARNING_THRESHOLD,
          critical: mem.usedRatio >= MEMORY_CRITICAL_THRESHOLD,
          activeSessions: ptys.size,
          dropCachesAvailable: dropCachesAvailable ?? false,
        })
      }
    }
  } catch { /* WSL not available or command failed — ignore */ } finally {
    memoryCheckRunning = false
  }
}

/** Stops the periodic WSL memory monitoring timer. */
function stopMemoryMonitoring(): void {
  if (memoryCheckTimer) {
    clearInterval(memoryCheckTimer)
    memoryCheckTimer = null
  }
  currentInterval = INTERVAL_NORMAL
}

/**
 * Converts a Windows path to its WSL mount path.
 * @param winPath - Windows-style path (e.g. `C:\Users\foo`).
 * @returns WSL path (e.g. `/mnt/c/Users/foo`).
 */
function toWslPath(winPath: string): string {
  return winPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
}

/**
 * Registers all terminal-related IPC handlers.
 * Must be called once during app initialization (from main/index.ts).
 */
export function registerTerminalHandlers(): void {
  // Kill all PTYs when the app quits — covers normal close AND crashes
  app.on('before-quit', killAllPtys)

  ipcMain.handle('terminal:getWslUsers', () => {
    return new Promise<string[]>((resolve) => {
      execFile('wsl.exe', ['--', 'cat', '/etc/passwd'], (err, stdout) => {
        if (err) { resolve([]); return }
        const users = stdout
          .split('\n')
          .map(line => line.trim().replace(/\r/g, ''))
          .filter(line => {
            const parts = line.split(':')
            if (parts.length < 7) return false
            const uid = parseInt(parts[2], 10)
            const shell = parts[6]
            return uid >= 1000 && !shell.includes('nologin') && !shell.includes('false')
          })
          .map(line => line.split(':')[0])
        resolve(users)
      })
    })
  })

  ipcMain.handle('terminal:getClaudeProfiles', async (_event, wslUser?: string) => {
    try {
      const args = wslUser ? ['-u', wslUser] : []
      args.push('--', 'bash', '-lc', 'ls ~/bin/ 2>/dev/null')
      const result = await execPromise('wsl.exe', args)
      const scripts = result.stdout
        .split('\n')
        .map(f => f.trim())
        .filter(f => /^claude(-[a-z0-9-]+)?$/.test(f))
        .sort()
      // Always include "claude" first (default profile)
      return ['claude', ...scripts.filter(s => s !== 'claude')]
    } catch {
      // If ~/bin/ doesn't exist, return just "claude"
      return ['claude']
    }
  })

  /**
   * Detect all WSL distros that have Claude Code installed.
   * Returns a ClaudeInstance array sorted with the default distro first.
   * Used by LaunchSessionModal to replace the raw WSL user selection.
   *
   * Detection strategy:
   * 1. List distros via `wsl.exe -l --verbose` (marks default with `*`)
   * 2. For each non-docker distro, run `bash -lc 'claude --version'` to check availability
   * 3. Also scan ~/bin/ for claude-* wrapper scripts (custom profiles)
   *
   * Note: wsl.exe outputs UTF-16LE on Windows — null bytes must be stripped.
   */
  ipcMain.handle('terminal:getClaudeInstances', async () => {
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
        // Default distro line starts with "*"
        const isDefault = line.startsWith('*')
        const cleaned = line.replace(/^\*\s*/, '')
        // First token is the distro name; skip docker-desktop (not interactive)
        const distro = cleaned.split(/\s+/)[0]
        if (distro && !distro.toLowerCase().includes('docker')) {
          distroEntries.push({ distro, isDefault })
        }
      }

      if (distroEntries.length === 0) return []

      // Step 2: check each distro for claude — max 2 concurrent to avoid overloading WSL
      const WSL_TIMEOUT = 10_000
      const CONCURRENCY = 2
      type DistroResult = { distro: string; version: string; isDefault: boolean; profiles: string[] } | null
      const results: DistroResult[] = []
      for (let i = 0; i < distroEntries.length; i += CONCURRENCY) {
        const batch = distroEntries.slice(i, i + CONCURRENCY)
        const batchResults = await Promise.all(batch.map(async ({ distro, isDefault }) => {
          try {
            const versionResult = await execPromise('wsl.exe', ['-d', distro, '--', 'bash', '-lc', 'claude --version 2>/dev/null'], { timeout: WSL_TIMEOUT })
            const rawVersion = versionResult.stdout.replace(/\0/g, '').trim()
            if (!rawVersion) return null
            // Parse "2.1.58 (Claude Code)" → "2.1.58"
            const version = rawVersion.split(' ')[0]

            // Step 3: scan ~/bin/ for claude-* wrapper scripts
            let profiles: string[] = ['claude']
            try {
              const binResult = await execPromise('wsl.exe', ['-d', distro, '--', 'bash', '-lc', 'ls ~/bin/ 2>/dev/null'], { timeout: WSL_TIMEOUT })
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
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
    } catch {
      // WSL not available or unexpected error
      return []
    }
  })

  ipcMain.handle('terminal:create', async (event, cols: number, rows: number, projectPath?: string, wslDistro?: string, systemPrompt?: string, userPrompt?: string, thinkingMode?: string, claudeCommand?: string, convId?: string) => {
    // Validate claudeCommand if provided
    if (claudeCommand && !CLAUDE_CMD_REGEX.test(claudeCommand)) {
      throw new Error("Invalid claudeCommand: " + claudeCommand)
    }
    // Validate convId if provided (must be a valid UUID)
    const validConvId = convId && UUID_REGEX.test(convId) ? convId : undefined

    const id = String(nextId++)
    const wcId = event.sender.id

    // Register cleanup for this webContents on first PTY creation
    if (!webContentsPtys.has(wcId)) {
      webContentsPtys.set(wcId, new Set())
      // When the renderer is destroyed (window close, crash, reload), kill its PTYs
      event.sender.once('destroyed', () => {
        const ids = webContentsPtys.get(wcId)
        if (ids) {
          for (const pid of ids) killPty(pid)
          webContentsPtys.delete(wcId)
        }
      })
    }
    webContentsPtys.get(wcId)!.add(id)

    const args: string[] = []

    // Temp script file path (Windows) — cleaned up in onExit
    let tempScriptWinPath: string | null = null

    // Use -d <distro> to target a specific WSL distro (falls back to default if not provided)
    if (wslDistro) args.push('-d', wslDistro)

    // ── Resume mode (task #218): use --resume <conv_id> if available ──────────
    // When a valid conversation ID is provided, skip system prompt injection and
    // resume the previous Claude Code session directly. This avoids re-injecting
    // ~2500 tokens of context on every session start.
    // Fallback: if conv_id is expired/invalid, Claude Code will show an error in
    // the terminal and the user can re-launch normally from LaunchSessionModal.
    if (validConvId) {
      const cmd = (claudeCommand && CLAUDE_CMD_REGEX.test(claudeCommand)) ? claudeCommand : 'claude'
      // Inject --settings alwaysThinkingEnabled:false when thinking_mode is 'disabled'
      const thinkingFlag = thinkingMode === 'disabled' ? ` --settings '{"alwaysThinkingEnabled":false}'` : ''
      const resumeScript = `exec ${cmd} --resume ${validConvId}${thinkingFlag}`
      if (projectPath) {
        args.push('--cd', toWslPath(projectPath), '--', 'bash', '-lc', resumeScript)
      } else {
        args.push('--', 'bash', '-lc', resumeScript)
      }
    // ── Normal agent launch: inject system prompt ─────────────────────────────
    // If systemPrompt is provided, launch Claude with the system prompt.
    // Uses wsl.exe -- bash -lc (login shell with command) to avoid shell injection.
    // wsl.exe does NOT accept -i as an argument (triggers "argument non valide" error).
    // -- separates WSL options from the shell command; bash -lc uses login shell for PATH.
    //
    // IMPORTANT CLI flags findings (per task #123):
    // - --append-system-prompt-file: print mode only - NOT for interactive agents
    // - --system-prompt and --append-system-prompt: work in BOTH interactive and print mode
    //   (--append recommended to preserve default Claude Code behaviors)
    // - --settings '{"alwaysThinkingEnabled":false}': disables extended thinking when thinking_mode='disabled'
    } else if (systemPrompt && userPrompt) {
      // Base64-encode system prompt AND user prompt to avoid shell injection.
      // Only [A-Za-z0-9+/=] chars in encoded strings — safe for shell embedding.
      const b64System = Buffer.from(systemPrompt).toString('base64')
      const b64User = Buffer.from(userPrompt).toString('base64')
      const cmd = (claudeCommand && CLAUDE_CMD_REGEX.test(claudeCommand)) ? claudeCommand : 'claude'
      // Inject --settings alwaysThinkingEnabled:false when thinking_mode is 'disabled'
      const thinkingFlag = thinkingMode === 'disabled' ? ` --settings '{"alwaysThinkingEnabled":false}'` : ''

      // ── Fix T278: write launch script to temp file ──────────────────────
      // wsl.exe re-parses the command line and breaks quoting for inline commands.
      // Solution: write the full command to a temp .sh file on the Windows FS,
      // then pass only `bash -l /mnt/c/.../script.sh` through wsl.exe.
      //
      // User prompt is passed as a CLI positional argument to `claude` so it
      // becomes the first message — no need for PTY readiness detection.
      // Both prompts are base64-decoded at runtime to prevent shell injection.
      const scriptName = `agent-prompt-${id}.sh`
      tempScriptWinPath = join(tmpdir(), scriptName)
      const scriptContent = `#!/bin/bash\nexec ${cmd} --append-system-prompt "$(echo '${b64System}' | base64 -d)"${thinkingFlag} "$(echo '${b64User}' | base64 -d)"\n`
      await writeFile(tempScriptWinPath, scriptContent, { encoding: 'utf8' })
      const scriptWslPath = toWslPath(tempScriptWinPath)

      if (projectPath) {
        args.push('--cd', toWslPath(projectPath), '--', 'bash', '-l', scriptWslPath)
      } else {
        args.push('--', 'bash', '-l', scriptWslPath)
      }

      // User prompt is passed as CLI positional arg → Claude auto-submits it.
      // No pendingUserPrompt needed — no PTY write required.
    } else if (projectPath) {
      args.push('--cd', toWslPath(projectPath))
    }

    // Build minimal env for PTY — avoid copying entire Electron process.env
    // This reduces memory per PTY (~50-200KB saved) and improves security
    // by not exposing potentially sensitive Electron env vars to WSL.
    //
    // IMPORTANT: wsl.exe uses Windows RPC to communicate with WSLService.exe.
    // Missing system env vars (SystemRoot, LOCALAPPDATA, etc.) breaks the RPC
    // handshake → Wsl/Service/0x8007072c ("handle type mismatch").
    // These Windows-specific vars must be forwarded even in minimal-env mode.
    const ptyEnv: Record<string, string> = {
      TERM: 'xterm-256color',
      LANG: process.env.LANG || 'en_US.UTF-8',
    }
    // Windows system vars required by wsl.exe RPC (WSLService communication)
    const wslRequiredVars = [
      'SystemRoot', 'SYSTEMROOT',   // Windows system dir — needed for RPC DLLs
      'LOCALAPPDATA',               // WSL distro registry/config location
      'USERPROFILE',                // User profile path
      'USERNAME',                   // Current user name
      'COMPUTERNAME',               // Machine name (RPC endpoint discovery)
      'WSLENV',                     // WSL↔Windows env bridging (optional but safe)
      'WSL_DISTRO_NAME',            // Default distro override (if set)
      'PATH',                       // Shell PATH
      'HOME',                       // Unix home (if set in Windows env)
    ]
    for (const v of wslRequiredVars) {
      if (process.env[v]) ptyEnv[v] = process.env[v]!
    }
    // HOME fallback: use USERPROFILE if HOME not set
    if (!ptyEnv.HOME && process.env.USERPROFILE) ptyEnv.HOME = process.env.USERPROFILE

    let pty: IPty
    try {
      pty = spawn('wsl.exe', args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: projectPath ?? (process.env.HOME ?? 'C:\\'),
        env: ptyEnv
      })
    } catch (err) {
      // WSL spawn failure (e.g. Wsl/Service/0x8007072c — RPC handle mismatch,
      // distro not found, or WSLService crashed).
      // Re-throw so the IPC caller receives a structured rejection instead of
      // a blank terminal. TerminalView.vue should catch and display the error.
      webContentsPtys.get(wcId)?.delete(id)
      throw new Error('WSL_SPAWN_ERROR: ' + String(err))
    }
    ptys.set(id, pty)

    // ── T279: Store launch params for crash recovery ─────────────────────
    ptyLaunchParams.set(id, { cols, rows, projectPath, wslDistro, systemPrompt, userPrompt, thinkingMode, claudeCommand, convId })

    // ── T279: Start memory monitoring on first PTY ───────────────────────
    startMemoryMonitoring(wcId)

    // Track agent sessions for graceful kill (normal launch OR resume)
    if (validConvId || (systemPrompt && userPrompt)) {
      agentPtys.add(id)
    }

    // ── Conv ID capture (task #218) ─────────────────────────────────────────
    // Monitor early PTY output to detect Claude Code's session UUID.
    // Once found, emit `terminal:convId:<id>` so the renderer can store it
    // in the DB via `session:setConvId` for future `--resume` launches.
    // We only scan the first ~8KB of output (startup banner) to avoid overhead.
    let convIdDetected = false
    let convIdBuffer = ''
    let convIdBytesRead = 0
    const CONV_ID_SCAN_LIMIT = 8192

    pty.onData(data => {
      if (event.sender.isDestroyed()) {
        // Renderer is gone but PTY is still running → kill it gracefully.
        gracefulKillPty(id)
        webContentsPtys.get(wcId)?.delete(id)
        return
      }

      // Scan for conversation ID in startup output (only if not yet detected)
      if (!convIdDetected && convIdBytesRead < CONV_ID_SCAN_LIMIT) {
        convIdBytesRead += data.length
        convIdBuffer += data
        // T371: Truncate buffer to avoid O(N)*chunks regex — keep last 512 chars
        if (convIdBuffer.length > 512) {
          convIdBuffer = convIdBuffer.slice(-512)
        }
        const match = CONV_ID_REGEX.exec(convIdBuffer)
        if (match && match[1]) {
          convIdDetected = true
          convIdBuffer = '' // free memory
          const params = ptyLaunchParams.get(id)
          if (params) params.detectedConvId = match[1]
          if (!event.sender.isDestroyed()) {
            event.sender.send(`terminal:convId:${id}`, match[1])
          }
        } else if (convIdBytesRead >= CONV_ID_SCAN_LIMIT) {
          convIdBuffer = ''
        }
      }

      event.sender.send(`terminal:data:${id}`, data)
    })

    pty.onExit(({ exitCode }) => {
      ptys.delete(id)
      webContentsPtys.get(wcId)?.delete(id)
      // Clean up temp script file written for system prompt injection (T278)
      if (tempScriptWinPath) {
        unlink(tempScriptWinPath).catch(() => { /* file may already be gone */ })
      }
      // Stop memory monitoring if no PTYs left
      if (ptys.size === 0) stopMemoryMonitoring()

      if (!event.sender.isDestroyed()) {
        // ── T279: Enhanced exit with crash recovery info ──────────────────
        const params = ptyLaunchParams.get(id)
        const isAgent = agentPtys.has(id)
        const canResume = !!(params?.detectedConvId || params?.convId)
        // exitCode !== 0 or signal kill suggests crash (OOM, etc.)
        const isCrash = exitCode !== 0 && exitCode !== null
        event.sender.send(`terminal:exit:${id}`, {
          exitCode,
          isCrash,
          isAgent,
          canResume,
          resumeConvId: params?.detectedConvId || params?.convId || null,
        })
      }
      agentPtys.delete(id)
      // Keep ptyLaunchParams[id] for potential relaunch via terminal:relaunch
    })

    return id
  })

  ipcMain.handle('terminal:write', (_event, id: string, data: string) => {
    ptys.get(id)?.write(data)
  })

  ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    ptys.get(id)?.resize(cols, rows)
  })

  ipcMain.handle('terminal:kill', (_event, id: string) => {
    gracefulKillPty(id)
    // Remove from webContents tracking
    for (const ids of webContentsPtys.values()) {
      ids.delete(id)
    }
  })

  ipcMain.handle('terminal:subscribe', (_event, _id: string) => {
    // Already subscribed via onData above, this is a no-op
    // but we expose it for re-subscription after hot-reload
  })

  // ── T279: Relaunch a crashed PTY session ─────────────────────────────
  // Uses stored launch params to re-create the PTY. If a convId was detected
  // during the previous session, uses --resume for continuity.
  ipcMain.handle('terminal:relaunch', async (event, oldId: string, useResume?: boolean) => {
    const params = ptyLaunchParams.get(oldId)
    if (!params) throw new Error('No launch params found for PTY ' + oldId)

    // Clean up old launch params
    ptyLaunchParams.delete(oldId)

    // If useResume and we have a detected convId, pass it for --resume
    const convId = useResume ? (params.detectedConvId || params.convId) : params.convId

    // Return the stored params so the renderer can call terminalCreate again.
    // We don't re-invoke terminal:create internally — the renderer handles re-creation.
    return {
      cols: params.cols,
      rows: params.rows,
      projectPath: params.projectPath,
      wslDistro: params.wslDistro,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
      thinkingMode: params.thinkingMode,
      claudeCommand: params.claudeCommand,
      convId: convId || undefined,
    }
  })

  // ── T279: Dismiss crash recovery (clean up stored launch params) ─────
  ipcMain.handle('terminal:dismissCrash', (_event, id: string) => {
    ptyLaunchParams.delete(id)
  })

  // ── T279: Get active session count and memory status ─────────────────
  ipcMain.handle('terminal:getActiveCount', () => {
    return ptys.size
  })

  ipcMain.handle('terminal:isAlive', (_event, id: string) => {
    return ptys.has(id)
  })

  // ── T279+T328: Get WSL memory status on demand ─────────────────────
  ipcMain.handle('terminal:getMemoryStatus', async () => {
    try {
      const { stdout } = await execPromise('wsl.exe', ['--', 'free', '-m'])
      const mem = parseFreeMOutput(stdout.replace(/\0/g, ''))
      if (!mem) return null
      return {
        usedMB: mem.usedMB,
        totalMB: mem.totalMB,
        availableMB: mem.availableMB,
        usedRatio: Math.round(mem.usedRatio * 100),
        warning: mem.usedRatio >= MEMORY_WARNING_THRESHOLD,
        critical: mem.usedRatio >= MEMORY_CRITICAL_THRESHOLD,
        activeSessions: ptys.size,
        dropCachesAvailable: dropCachesAvailable ?? false,
      }
    } catch {
      return null
    }
  })

  // ── T328: Release WSL memory (manual or auto) ─────────────────────
  ipcMain.handle('terminal:releaseMemory', async () => {
    return releaseWslMemory()
  })
}

// ── Test-only exports ─────────────────────────────────────────────────────
// Exported for unit testing internal helpers without exposing them in the public API.
export const _testing = {
  parseFreeMOutput,
  releaseWslMemory,
  checkDropCachesCapability,
  doMemoryCheck,
  toWslPath,
  ptys,
  get dropCachesAvailable() { return dropCachesAvailable },
  set dropCachesAvailable(v: boolean | null) { dropCachesAvailable = v },
  get lastAutoReleaseAt() { return lastAutoReleaseAt },
  set lastAutoReleaseAt(v: number) { lastAutoReleaseAt = v },
  get memoryCheckRunning() { return memoryCheckRunning },
  set memoryCheckRunning(v: boolean) { memoryCheckRunning = v },
  MEMORY_RELEASE_COOLDOWN_MS,
  MEMORY_CRITICAL_THRESHOLD,
}
