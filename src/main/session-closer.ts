/**
 * Session closer — auto-closes started sessions when their associated task is done.
 *
 * Poll interval: 30s. Started from ipc-db.ts on watch-db / stopped on unwatch-db.
 *
 * Logic: every 30s, find sessions in 'started' whose agent has at least one task
 * in 'done' for more than 1 minute AND no task in 'todo' or 'in_progress'.
 * Uses agent_id FK instead of summary LIKE (which matched nothing on active sessions).
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
 * Close all started sessions whose agent has completed all tasks (none in todo/in_progress)
 * and has at least one task in 'done' for > 1 minute.
 *
 * Uses agent_id FK match instead of summary LIKE — active sessions have NULL summary,
 * so the old LIKE pattern never matched.
 *
 * Exported for testing.
 */
export async function closeZombieSessions(dbPath: string): Promise<void> {
  assertDbPathAllowed(dbPath)
  await writeDb(dbPath, (db) => {
    db.run(`
      UPDATE sessions
      SET status = 'completed', ended_at = datetime('now')
      WHERE status = 'started'
        AND agent_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.agent_assigned_id = sessions.agent_id
            AND t.status IN ('todo', 'in_progress')
        )
        AND EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.agent_assigned_id = sessions.agent_id
            AND t.status = 'done'
            AND t.updated_at < datetime('now', '-1 minute')
        )
    `)
  })
}
