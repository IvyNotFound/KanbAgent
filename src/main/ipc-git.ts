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
