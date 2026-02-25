import { ipcMain, app } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { execFile } from 'child_process'
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

function killPty(id: string): void {
  const pty = ptys.get(id)
  if (!pty) return
  try { pty.kill() } catch { /* already dead */ }
  ptys.delete(id)
  agentPtys.delete(id)
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

  const isAgentSession = agentPtys.has(id)

  if (isAgentSession) {
    // Step 1: Send Ctrl+C x2 to interrupt Claude
    pty.write('\x03\x03')

    // Step 2: After 100ms, send 'exit' to close bash
    setTimeout(() => {
      const currentPty = ptys.get(id)
      if (currentPty) {
        currentPty.write('exit\r')
      }
    }, 100)

    // Step 3: Force kill after 300ms if still alive
    setTimeout(() => {
      killPty(id)
    }, 300)
  } else {
    // Regular bash session - just kill immediately
    killPty(id)
  }
}

function killAllPtys(): void {
  for (const id of [...ptys.keys()]) {
    gracefulKillPty(id)
  }
  webContentsPtys.clear()
}

function toWslPath(winPath: string): string {
  return winPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
}

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

      // Step 2: check each distro for claude in parallel
      const instancePromises = distroEntries.map(async ({ distro, isDefault }) => {
        try {
          const versionResult = await execPromise('wsl.exe', ['-d', distro, '--', 'bash', '-lc', 'claude --version 2>/dev/null'])
          const rawVersion = versionResult.stdout.replace(/\0/g, '').trim()
          if (!rawVersion) return null
          // Parse "2.1.58 (Claude Code)" → "2.1.58"
          const version = rawVersion.split(' ')[0]

          // Step 3: scan ~/bin/ for claude-* wrapper scripts
          let profiles: string[] = ['claude']
          try {
            const binResult = await execPromise('wsl.exe', ['-d', distro, '--', 'bash', '-lc', 'ls ~/bin/ 2>/dev/null'])
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
          // Claude not installed in this distro
          return null
        }
      })

      const results = await Promise.all(instancePromises)
      // Filter out nulls and sort: default distro first
      return results
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
    } catch {
      // WSL not available or unexpected error
      return []
    }
  })

  ipcMain.handle('terminal:create', (event, cols: number, rows: number, projectPath?: string, wslDistro?: string, systemPrompt?: string, userPrompt?: string, thinkingMode?: string, claudeCommand?: string, convId?: string) => {
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
        args.push('--cd', toWslPath(projectPath), '-i', '-c', resumeScript)
      } else {
        args.push('-i', '-c', resumeScript)
      }
    // ── Normal agent launch: inject system prompt ─────────────────────────────
    // If systemPrompt is provided, launch Claude with the system prompt.
    // Uses wsl.exe -i -c (interactive bash with command) + heredoc to avoid shell injection.
    // This fixes vulnerability from $(), backticks, $VAR, newlines that were interpreted by bash -lc.
    //
    // IMPORTANT CLI flags findings (per task #123):
    // - --append-system-prompt-file: print mode only - NOT for interactive agents
    // - --system-prompt and --append-system-prompt: work in BOTH interactive and print mode
    //   (--append recommended to preserve default Claude Code behaviors)
    // - --settings '{"alwaysThinkingEnabled":false}': disables extended thinking when thinking_mode='disabled'
    // - Using heredoc in bash to safely pass inline prompts without shell injection
    } else if (systemPrompt && userPrompt) {
      // Use heredoc to safely embed system prompt inline without shell injection risk
      // This escapes $() backticks, $VAR, etc. by using proper quoting in heredoc
      // The user prompt (autoSend) is sent via PTY write after Claude starts
      const escapedSystemPrompt = systemPrompt.replace(/'/g, "'\\''").replace(/\n/g, '\\n')
      const cmd = (claudeCommand && CLAUDE_CMD_REGEX.test(claudeCommand)) ? claudeCommand : 'claude'
      // Inject --settings alwaysThinkingEnabled:false when thinking_mode is 'disabled'
      const thinkingFlag = thinkingMode === 'disabled' ? ` --settings '{"alwaysThinkingEnabled":false}'` : ''
      // TODO(#219): add --cache-system-prompt flag once supported by Claude Code CLI.
      // This flag activates Anthropic prompt caching (~80% token reduction on system prompt
      // after first turn). Checked on v2.1.56: flag does not exist yet.
      // Expected flag: `exec ${cmd} --append-system-prompt '...' --cache-system-prompt`
      const wrapperScript = `exec ${cmd} --append-system-prompt '${escapedSystemPrompt}'${thinkingFlag}`

      if (projectPath) {
        args.push('--cd', toWslPath(projectPath), '-i', '-c', wrapperScript)
      } else {
        args.push('-i', '-c', wrapperScript)
      }

      // Send user prompt (autoSend) after a short delay to ensure Claude is ready
      // This is the correct way to pass user input - not via --append-system-prompt
      setTimeout(() => {
        const pty = ptys.get(id)
        if (pty) {
          pty.write(userPrompt + '\n')
        }
      }, 2000)
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
    const CONV_ID_SCAN_LIMIT = 8192

    pty.onData(data => {
      if (event.sender.isDestroyed()) {
        // Renderer is gone but PTY is still running → kill it gracefully.
        // Sends Ctrl+C to interrupt Claude, then exit to close bash.
        gracefulKillPty(id)
        webContentsPtys.get(wcId)?.delete(id)
        return
      }

      // Scan for conversation ID in startup output (only if not yet detected)
      if (!convIdDetected && convIdBuffer.length < CONV_ID_SCAN_LIMIT) {
        convIdBuffer += data
        const match = CONV_ID_REGEX.exec(convIdBuffer)
        if (match && match[1]) {
          convIdDetected = true
          convIdBuffer = '' // free memory
          if (!event.sender.isDestroyed()) {
            event.sender.send(`terminal:convId:${id}`, match[1])
          }
        } else if (convIdBuffer.length >= CONV_ID_SCAN_LIMIT) {
          // Stop scanning — conv_id not found in startup banner
          convIdBuffer = ''
        }
      }

      event.sender.send(`terminal:data:${id}`, data)
    })

    pty.onExit(() => {
      ptys.delete(id)
      webContentsPtys.get(wcId)?.delete(id)
      if (!event.sender.isDestroyed()) {
        event.sender.send(`terminal:exit:${id}`)
      }
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
}
