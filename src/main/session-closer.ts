/**
 * Session closer — auto-closes started sessions when their associated task is done,
 * and detects sessions manually closed between poll cycles.
 *
 * Poll interval: 30s. Started from ipc-db.ts on watch-db / stopped on unwatch-db.
 *
 * Logic: every 30s,
 * 1. Zombie-close: find sessions in 'started' whose agent has at least one task
 *    in 'done' for more than 1 minute (done AFTER the session started) AND no
 *    task in 'todo' or 'in_progress'. Tasks from previous sessions are ignored.
 * 2. Manually-closed: find sessions that transitioned to 'completed' since last poll
 *    (covers agents with no assigned tasks, e.g. review, doc).
 *
 * Uses agent_id FK instead of summary LIKE (which matched nothing on active sessions).
 *
 * @module session-closer
 */

import { writeDb, queryLive, assertDbPathAllowed } from './db'

let pollerInterval: ReturnType<typeof setInterval> | null = null

/**
 * Timestamp of the last poll cycle end (SQLite format: 'YYYY-MM-DD HH:MM:SS').
 * Used by detectManuallyClosed to find sessions closed since the last cycle.
 * Initialized to now() on startSessionCloser to avoid re-emitting old sessions.
 */
let lastCheckedAt: string = ''

/** Return current time as SQLite datetime string ('YYYY-MM-DD HH:MM:SS'). */
function currentSqliteTime(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

/**
 * Start periodic poll (30s) that closes started sessions
 * whose associated task has been in 'done' for more than 1 minute,
 * and emits agent_ids for sessions that were manually closed between cycles.
 * Replaces any existing poller.
 *
 * @param onSessionsClosed - Optional callback called with the list of agent_ids
 *   whose sessions were closed. Only invoked when at least one session is closed.
 */
export function startSessionCloser(
  dbPath: string,
  onSessionsClosed?: (agentIds: number[]) => void
): void {
  stopSessionCloser()
  lastCheckedAt = currentSqliteTime()
  pollerInterval = setInterval(async () => {
    try {
      const zombieIds = await closeZombieSessions(dbPath)
      const manualIds = await detectManuallyClosed(dbPath, lastCheckedAt)
      lastCheckedAt = currentSqliteTime()
      const allIds = [...new Set([...zombieIds, ...manualIds])]
      if (allIds.length > 0) onSessionsClosed?.(allIds)
    } catch (err) {
      console.error('[session-closer] poll error:', err)
    }
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
 * @returns List of agent_ids whose sessions were closed (empty if none).
 *
 * Exported for testing.
 */
export async function closeZombieSessions(dbPath: string): Promise<number[]> {
  assertDbPathAllowed(dbPath)
  const ELIGIBILITY_WHERE = `
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
            AND t.updated_at > sessions.started_at
        )`
  let closedAgentIds: number[] = []
  await writeDb(dbPath, (db) => {
    const result = db.exec(`SELECT DISTINCT agent_id FROM sessions ${ELIGIBILITY_WHERE}`)
    closedAgentIds = result[0]?.values.map((r) => r[0] as number) ?? []
    if (closedAgentIds.length === 0) return false
    db.run(`UPDATE sessions SET status = 'completed', ended_at = datetime('now') ${ELIGIBILITY_WHERE}`)
    // T1110: return false when 0 rows modified → writeDb skips export+write
    return db.getRowsModified() > 0
  })
  return closedAgentIds
}

/**
 * Detect sessions that transitioned to 'completed' since the last poll cycle.
 * Covers agents with no assigned tasks (review, doc, etc.) who close their own session.
 *
 * Uses `ended_at > since` (strictly greater) to avoid re-emitting sessions already
 * detected in the previous cycle.
 *
 * @param since - SQLite datetime string; only sessions closed strictly after this are returned.
 * @returns List of agent_ids whose sessions were manually closed since `since`.
 *
 * Exported for testing.
 */
export async function detectManuallyClosed(dbPath: string, since: string): Promise<number[]> {
  assertDbPathAllowed(dbPath)
  const rows = await queryLive(
    dbPath,
    `SELECT DISTINCT agent_id FROM sessions
     WHERE status = 'completed'
       AND ended_at > ?
       AND agent_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM sessions s2
         WHERE s2.agent_id = sessions.agent_id
           AND s2.status = 'started'
       )`,
    [since]
  )
  return rows.map((r) => (r as { agent_id: number }).agent_id)
}
