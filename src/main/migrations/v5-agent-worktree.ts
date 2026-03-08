import type { Database } from 'sql.js'

/**
 * Migration: Add worktree_enabled column to agents table (T1142).
 *
 * Tri-state semantics:
 *   NULL = inherit from global config (worktree_default)
 *   0    = worktree disabled for this agent
 *   1    = worktree enabled for this agent
 *
 * Idempotent: returns false if column already exists.
 *
 * @returns true if the column was added, false if already present.
 */
export function runAddWorktreeToAgentsMigration(db: Database): boolean {
  const colResult = db.exec('PRAGMA table_info(agents)')
  if (colResult.length === 0 || colResult[0].values.length === 0) return false

  const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))
  if (cols.has('worktree_enabled')) return false

  db.run('ALTER TABLE agents ADD COLUMN worktree_enabled INTEGER')
  return true
}
