/**
 * Startup cleanup for orphaned git worktrees.
 *
 * At app startup, iterates over all known (trusted) project paths,
 * finds their SQLite database, and prunes any worktrees left over
 * from crashed agent sessions.
 *
 * @module worktree-cleanup
 */
import { join } from 'path'
import { access } from 'fs/promises'
import { getAllowedProjectPaths } from './db'
import { pruneOrphanedWorktrees } from './worktree-manager'

/**
 * Clean up orphaned git worktrees at app startup.
 *
 * Iterates over all known project paths, finds their `.claude/project.db`,
 * and calls pruneOrphanedWorktrees for each. Best-effort per project:
 * errors are logged but do not block startup.
 */
export async function cleanupOrphanWorktreesAtStartup(): Promise<void> {
  const projectPaths = getAllowedProjectPaths()
  for (const projectPath of projectPaths) {
    const dbPath = join(projectPath, '.claude', 'project.db')
    try {
      await access(dbPath)
      await pruneOrphanedWorktrees(projectPath, dbPath)
    } catch (err) {
      // Project DB not found or cleanup failed — skip silently (non-fatal)
      console.warn(
        `[worktree-cleanup] skipping ${projectPath}:`,
        err instanceof Error ? err.message : err
      )
    }
  }
}
