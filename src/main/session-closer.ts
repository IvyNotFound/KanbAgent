/**
 * Session closer — auto-closes started sessions when their associated task is done.
 *
 * Poll interval: 30s. Started from ipc-db.ts on watch-db / stopped on unwatch-db.
 *
 * Logic: every 30s, find sessions in 'started' whose summary mentions a task that
 * has been in 'done' for more than 1 minute, and mark them 'completed'.
 *
 * @module session-closer
 */

import { writeDb, assertDbPathAllowed } from './db'

let pollerInterval: ReturnType<typeof setInterval> | null = null

/**
 * Start periodic poll (30s) that closes started sessions
 * whose associated task has been in 'done' for more than 1 minute.
 * Replaces any existing poller.
 */
export function startSessionCloser(dbPath: string): void {
  stopSessionCloser()
  pollerInterval = setInterval(() => {
    closeZombieSessions(dbPath).catch((err) => {
      console.error('[session-closer] poll error:', err)
    })
  }, 30_000)
  console.log('[session-closer] started for', dbPath)
}

/** Stop session closer and clear interval. */
export function stopSessionCloser(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval)
    pollerInterval = null
  }
}

/**
 * Close all started sessions whose summary mentions a task in 'done' for > 1 minute.
 *
 * Summary format: "Done:T<id>[...] Pending:... Next:..."
 * Pattern: `%T<id>[%` matches this format specifically (avoids false positives like T9 vs T90).
 *
 * Exported for testing.
 */
export async function closeZombieSessions(dbPath: string): Promise<void> {
  assertDbPathAllowed(dbPath)
  await writeDb(dbPath, (db) => {
    db.run(`
      UPDATE sessions
      SET statut = 'completed', ended_at = datetime('now')
      WHERE statut = 'started'
        AND EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.statut = 'done'
            AND t.updated_at < datetime('now', '-1 minute')
            AND sessions.summary LIKE '%T' || CAST(t.id AS TEXT) || '[%'
        )
    `)
  })
}
