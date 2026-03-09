/**
 * IPC Handlers — Git operations
 *
 * Covers: git:log (+ future git handlers)
 *
 * @module ipc-git
 */

import { ipcMain } from 'electron'
import { assertProjectPathAllowed } from './db'

/** Register git IPC handlers. */
export function registerGitHandlers(): void {
  /**
   * Create a git worktree for multi-instance isolation (ADR-006).
   * Branch: agent/<agentName>/s<sessionId> — Worktree: .claude/worktrees/s<sessionId>
   * Idempotent: returns success if worktree already exists.
   * @param projectPath - Registered project root (validated via allowlist)
   * @param sessionId   - Unique session nonce (alphanumeric + hyphens only)
   * @param agentName   - Agent name (alphanumeric + hyphens only, sanitized)
   */
  ipcMain.handle('git:worktree-create', async (_event, projectPath: string, sessionId: string, agentName: string) => {
    assertProjectPathAllowed(projectPath)
    if (!/^[\w-]+$/.test(sessionId)) return { success: false, error: 'Invalid sessionId' }
    if (!/^[\w-]+$/.test(agentName)) return { success: false, error: 'Invalid agentName' }

    const { join } = await import('path')
    const { execFile } = await import('child_process')
    const workDir = join(projectPath, '.claude', 'worktrees', `s${sessionId}`)
    const branch = `agent/${agentName}/s${sessionId}`

    try {
      await new Promise<void>((resolve, reject) => {
        execFile('git', ['worktree', 'add', workDir, '-b', branch], { cwd: projectPath }, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
      return { success: true, workDir }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // Idempotent: already exists is not an error
      if (msg.includes('already exists') || msg.includes('already linked') || msg.includes('already checked out')) {
        return { success: true, workDir }
      }
      return { success: false, error: msg }
    }
  })

  /**
   * Remove a git worktree by its absolute path (T1205).
   *
   * Called on tab close to ensure orphan worktrees are cleaned up independently
   * of whether the agent process has already exited or not.
   * Idempotent: resolves successfully if the worktree is already gone.
   *
   * @param projectPath - Registered project root (validated via allowlist)
   * @param workDir     - Absolute path to the worktree directory to remove
   */
  ipcMain.handle('git:worktree-remove', async (_event, projectPath: string, workDir: string) => {
    assertProjectPathAllowed(projectPath)
    if (!workDir || typeof workDir !== 'string' || workDir.trim() === '') {
      return { success: false, error: 'Invalid workDir' }
    }
    const { removeWorktreeByPath } = await import('./worktree-manager')
    await removeWorktreeByPath(projectPath, workDir)
    return { success: true }
  })

  /**
   * Execute `git log` on the registered project path and return parsed commits.
   * @param projectPath - Registered project root (validated via allowlist)
   * @param options - { limit?: number (1-500, default 100), since?: string (date string) }
   * @returns {GitCommit[]} Parsed commits, or [] if not a git repo or on error
   */
  ipcMain.handle('git:log', async (_event, projectPath: string, options?: { limit?: number; since?: string }) => {
    assertProjectPathAllowed(projectPath)
    try {
      const { execFile } = await import('child_process')
      const SEP = '\x1F'
      const limit = Math.min(Math.max(1, Math.floor(Number(options?.limit ?? 100))), 500)
      const args = ['log', `--format=%h${SEP}%aI${SEP}%s${SEP}%an`, '-n', String(limit)]
      if (options?.since && /^[\w\d\s\-:.+]+$/.test(options.since)) {
        args.push(`--since=${options.since}`)
      }
      const raw = await new Promise<string>((resolve, reject) => {
        execFile('git', args, { cwd: projectPath, encoding: 'utf-8' }, (err, stdout) => {
          if (err) reject(err)
          else resolve(stdout as string)
        })
      })
      return raw.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.split(SEP)
        const hash = parts[0] ?? ''
        const date = parts[1] ?? ''
        const subject = parts[2] ?? ''
        const author = parts[3] ?? ''
        const taskIds = [...subject.matchAll(/\bT(\d+)\b/g)].map(m => parseInt(m[1], 10))
        return { hash, date, subject, author, taskIds }
      })
    } catch (err) {
      console.warn('[ipc-git] git:log failed for', projectPath, err)
      return []
    }
  })
}
