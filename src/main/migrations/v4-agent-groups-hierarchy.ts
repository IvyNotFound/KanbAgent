import type { Database } from 'sql.js'

/**
 * Migration: Add parent_id column to agent_groups for nested group support (T945).
 *
 * Adds `parent_id INTEGER` (nullable, no inline FK constraint — SQLite ALTER TABLE
 * limitation). Children of a deleted parent are set to NULL automatically by
 * the setParent IPC handler. Integrity is enforced in application code.
 *
 * Idempotent: returns false if parent_id already exists.
 *
 * @returns true if the column was added, false if already present.
 */
export function runAddParentIdToAgentGroupsMigration(db: Database): boolean {
  const colResult = db.exec('PRAGMA table_info(agent_groups)')
  if (colResult.length === 0 || colResult[0].values.length === 0) return false

  const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))
  if (cols.has('parent_id')) return false

  db.run('ALTER TABLE agent_groups ADD COLUMN parent_id INTEGER')
  return true
}
