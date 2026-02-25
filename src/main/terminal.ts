import { ipcMain, app } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { execFile } from 'child_process'

const ptys = new Map<string, IPty>()

// Track which PTY IDs belong to each WebContents (by webContents.id)
// Allows automatic cleanup when a renderer is destroyed (window close, crash)
const webContentsPtys = new Map<number, Set<string>>()

let nextId = 1

function killPty(id: string): void {
  const pty = ptys.get(id)
  if (!pty) return
  try { pty.kill() } catch { /* already dead */ }
  ptys.delete(id)
}

function killAllPtys(): void {
  for (const id of [...ptys.keys()]) {
    killPty(id)
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

  ipcMain.handle('terminal:create', (event, cols: number, rows: number, projectPath?: string, wslUser?: string, systemPrompt?: string, userPrompt?: string, thinkingMode?: string) => {
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
    if (wslUser) args.push('-u', wslUser)

    // If systemPrompt is provided, launch Claude directly with the system prompt
    // This bypasses the interactive shell and injects the system prompt via CLI flag
    if (systemPrompt && userPrompt) {
      // Build the claude command with --system-prompt
      // Escape quotes in both prompts for shell safety
      const escapedSystemPrompt = systemPrompt.replace(/"/g, '\\"')
      const escapedUserPrompt = userPrompt.replace(/"/g, '\\"')
      // --thinking disabled: disables extended thinking for low-reflection agent types
      // budget_tokens: reserved — CLI flag not yet available, falls back to auto (no flag injected)
      // NOTE: flag syntax verified against Claude Code CLI — adjust if Claude updates its API
      const thinkingFlag = thinkingMode === 'disabled'
        ? ' --thinking disabled'
        : '' // 'auto' and 'budget_tokens' both use no flag for now
      const claudeCmd = `claude --system-prompt "${escapedSystemPrompt}"${thinkingFlag} "${escapedUserPrompt}"`
      if (projectPath) {
        args.push('--cd', toWslPath(projectPath), '--', 'bash', '-c', claudeCmd)
      } else {
        args.push('--', 'bash', '-c', claudeCmd)
      }
    } else if (projectPath) {
      args.push('--cd', toWslPath(projectPath))
    }

    const pty = spawn('wsl.exe', args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: projectPath ?? (process.env.HOME ?? 'C:\\'),
      env: process.env as Record<string, string>
    })
    ptys.set(id, pty)

    pty.onData(data => {
      if (event.sender.isDestroyed()) {
        // Renderer is gone but PTY is still running → kill it immediately.
        // Without this, the wsl.exe process survives as an orphan and blocks WSL.
        killPty(id)
        webContentsPtys.get(wcId)?.delete(id)
        return
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
    killPty(id)
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
