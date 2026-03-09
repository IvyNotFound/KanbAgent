/**
 * Git worktree manager for agent session isolation.
 *
 * Creates an isolated git worktree before spawning a CLI session and removes it
 * when the session ends. Works for all CLI adapters (Claude, Codex, Gemini, etc.)
 * without adapter-specific changes.
 *
 * Worktree location: <repoRoot>/../agent-worktrees/<sessionId>
 * Branch name: agent/<sessionId>
 *
 * @module worktree-manager
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { queryLive } from './db'

const execFileAsync = promisify(execFile)

export interface WorktreeInfo {
  /** Absolute path to the created worktree directory. */
  path: string
  /** Name of the branch created for this worktree. */
  branch: string
}

/**
 * Create an isolated git worktree for an agent session.
 *
 * Branch: agent/<sessionId>
 * Path: <repoRoot>/../agent-worktrees/<sessionId>
 *
 * If the branch already exists (session restart), falls back to attaching
 * the existing branch without -b.
 *
 * @throws if git is unavailable or the repo root is invalid
 */
export async function createWorktree(repoRoot: string, sessionId: number): Promise<WorktreeInfo> {
  const branch = `agent/${sessionId}`
  const wtPath = path.resolve(repoRoot, '..', 'agent-worktrees', String(sessionId))

  try {
    await execFileAsync('git', ['-C', repoRoot, 'worktree', 'add', '-b', branch, wtPath, 'HEAD'])
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // Branch already exists (session restart) — attach without -b
    if (msg.includes('already exists') || msg.includes('already linked') || msg.includes('already checked out')) {
      await execFileAsync('git', ['-C', repoRoot, 'worktree', 'add', wtPath, branch])
    } else {
      throw err
    }
  }

  return { path: wtPath, branch }
}

/**
 * Remove the worktree and its branch after a session ends.
 * Errors are swallowed — removal is best-effort.
 */
export async function removeWorktree(repoRoot: string, sessionId: number): Promise<void> {
  const branch = `agent/${sessionId}`
  const wtPath = path.resolve(repoRoot, '..', 'agent-worktrees', String(sessionId))

  try {
    await execFileAsync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', wtPath])
  } catch { /* already removed or missing — ignore */ }

  try {
    await execFileAsync('git', ['-C', repoRoot, 'branch', '-D', branch])
  } catch { /* already deleted or missing — ignore */ }
}

/**
 * Remove a worktree by its absolute path rather than by session ID.
 *
 * Discovers the associated branch via `git worktree list --porcelain` before removal,
 * so the branch is deleted even when the session ID is not available (e.g. on tab close).
 * Both the worktree removal and the branch deletion are best-effort: errors are swallowed.
 *
 * Idempotent: if the worktree or branch is already gone, resolves without error.
 *
 * @param repoRoot     - Absolute path to the git repository root.
 * @param worktreePath - Absolute path to the worktree directory to remove.
 */
export async function removeWorktreeByPath(repoRoot: string, worktreePath: string): Promise<void> {
  const targetPath = path.resolve(worktreePath)

  // Discover the branch associated with the worktree (best-effort).
  // Uses a manual Promise wrapper (not execFileAsync) to reliably capture stdout as a string.
  let branch: string | null = null
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], (err, out) => {
        if (err) reject(err)
        else resolve(out)
      })
    })
    for (const block of stdout.trim().split(/\n\n+/)) {
      const lines = block.trim().split('\n')
      const worktreeLine = lines.find(l => l.startsWith('worktree '))
      const branchLine = lines.find(l => l.startsWith('branch '))
      if (worktreeLine && branchLine && path.resolve(worktreeLine.slice('worktree '.length).trim()) === targetPath) {
        branch = branchLine.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
        break
      }
    }
  } catch { /* best-effort — ignore */ }

  // Remove the worktree
  try {
    await execFileAsync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', targetPath])
  } catch { /* already removed or missing — ignore */ }

  // Delete the associated branch if found
  if (branch) {
    try {
      await execFileAsync('git', ['-C', repoRoot, 'branch', '-D', branch])
    } catch { /* already deleted — ignore */ }
  }
}

/**
 * Prune stale worktree administrative files.
 * Call at app startup to clean up orphaned worktrees from crashed sessions.
 */
export async function pruneWorktrees(repoRoot: string): Promise<void> {
  await execFileAsync('git', ['-C', repoRoot, 'worktree', 'prune'])
}

/** Parse `git worktree list --porcelain` output into a list of entries. */
export function parseWorktreeList(output: string): Array<{ path: string; branch: string | null }> {
  return output
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split('\n')
      const wtPath = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length) ?? ''
      const branch = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length) ?? null
      return { path: wtPath, branch }
    })
    .filter((wt) => wt.path !== '')
}

/**
 * Prune orphaned worktrees when a project is loaded.
 *
 * Handles two branch formats:
 * - Old: `agent/<sessionId>` — checked against DB; removed if session ended or absent.
 * - New: `agent/<name>/s<timestamp>` — removed if timestamp is older than 4 hours.
 *
 * Calls `git worktree prune` at the end to clean up git admin files.
 * Best-effort: errors are logged but do not throw.
 *
 * @param repoRoot - Absolute path to the git repository root.
 * @param dbPath   - Registered path to the project SQLite database.
 */
export async function pruneOrphanedWorktrees(repoRoot: string, dbPath: string): Promise<void> {
  // Uses a manual Promise wrapper (not execFileAsync) to reliably capture stdout as a string.
  let stdout: string
  try {
    stdout = await new Promise<string>((resolve, reject) => {
      execFile('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], (err, out) => {
        if (err) reject(err)
        else resolve(out)
      })
    })
  } catch (err) {
    console.warn('[pruneOrphanedWorktrees] git worktree list failed:', err)
    return
  }

  const worktrees = parseWorktreeList(stdout)

  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

  for (const wt of worktrees) {
    if (!wt.branch) continue

    // Old format: agent/<sessionId> — correlate with DB
    const oldMatch = /^refs\/heads\/agent\/(\d+)$/.exec(wt.branch)
    if (oldMatch) {
      const sessionId = parseInt(oldMatch[1], 10)

      let shouldRemove: boolean
      try {
        const rows = await queryLive(dbPath, 'SELECT ended_at, status FROM sessions WHERE id = ?', [sessionId])
        const session = rows[0] as { ended_at: string | null; status: string } | undefined
        shouldRemove = !session || session.ended_at !== null || session.status === 'completed'
      } catch (err) {
        console.warn(`[pruneOrphanedWorktrees] DB query failed for session ${sessionId}:`, err)
        continue
      }

      if (!shouldRemove) continue

      console.log(`[pruneOrphanedWorktrees] removing orphaned worktree for session ${sessionId}`)
      await removeWorktree(repoRoot, sessionId)
      continue
    }

    // New format: agent/<name>/s<timestamp> — temporal heuristic (> 4h = stale)
    const newMatch = /^refs\/heads\/agent\/([^/]+)\/s(\d+)$/.exec(wt.branch)
    if (!newMatch) continue

    const timestamp = parseInt(newMatch[2], 10)
    if (Date.now() - timestamp <= FOUR_HOURS_MS) continue

    const fullBranch = `agent/${newMatch[1]}/s${newMatch[2]}`
    console.log(`[pruneOrphanedWorktrees] removing stale new-format worktree: ${fullBranch}`)
    try {
      await execFileAsync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', wt.path])
    } catch { /* best-effort */ }
    try {
      await execFileAsync('git', ['-C', repoRoot, 'branch', '-D', fullBranch])
    } catch { /* best-effort */ }
  }

  try {
    await pruneWorktrees(repoRoot)
  } catch (err) {
    console.warn('[pruneOrphanedWorktrees] git worktree prune failed:', err)
  }
}
