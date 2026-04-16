import type { MigrationDb } from '../migration-db-adapter'
type Database = MigrationDb

/**
 * Migration v41: Add composite index sessions(status, ended_at DESC) (T1976).
 *
 * The detectManuallyClosed() poll runs every 30s with:
 *   WHERE status = 'completed' AND ended_at > ?
 *
 * Only idx_sessions_status (single column) existed, causing a post-filter on
 * ended_at after the index scan on status.
 *
 * This covering index eliminates the post-filter for that query.
 *
 * Idempotent: CREATE INDEX IF NOT EXISTS is safe to re-run.
 */
export function runAddSessionsStatusEndedIndexMigration(db: Database): void {
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_sessions_status_ended ON sessions(status, ended_at DESC)'
  )
}
