/**
 * IPC Handlers — Session result, cost stats, and task status management
 *
 * Covers: session:updateResult, sessions:statsCost, tasks:getArchived,
 *         tasks:updateStatus
 *
 * @module ipc-session-stats
 */

import { ipcMain } from 'electron'
import { assertDbPathAllowed, queryLive, writeDb } from './db'

/** Register session stats and task status IPC handlers. */
export function registerSessionStatsHandlers(): void {
  /**
   * Persist cost_usd, duration_ms, num_turns from the Claude `result` event into a session row.
   * @param dbPath - Registered DB path
   * @param sessionId - Session ID to update
   * @param data - Partial result data (null fields are stored as NULL)
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('session:updateResult', async (_event, dbPath: string, sessionId: number, data: {
    cost_usd?: number | null
    duration_ms?: number | null
    num_turns?: number | null
  }) => {
    assertDbPathAllowed(dbPath)
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return { success: false, error: 'INVALID_SESSION_ID' }
    }
    try {
      await writeDb(dbPath, (db) => {
        db.run(
          `UPDATE sessions SET cost_usd=?, duration_ms=?, num_turns=?, updated_at=datetime('now') WHERE id=?`,
          [data.cost_usd ?? null, data.duration_ms ?? null, data.num_turns ?? null, sessionId]
        )
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC session:updateResult]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Aggregate cost/duration/token stats per agent and period.
   * @param dbPath - Registered DB path
   * @param params - { period: 'day'|'week'|'month', agentId?: number, limit?: number (default 30) }
   * @returns {{ success: boolean, rows: unknown[], error?: string }}
   */
  ipcMain.handle('sessions:statsCost', async (_event, dbPath: string, params: {
    period: 'day' | 'week' | 'month'
    agentId?: number
    limit?: number
  }) => {
    assertDbPathAllowed(dbPath)
    const PERIOD_FORMATS: Record<string, string> = {
      day: '%Y-%m-%d',
      week: '%Y-%W',
      month: '%Y-%m'
    }
    const periodFmt = PERIOD_FORMATS[params?.period]
    if (!periodFmt) return { success: false, error: 'INVALID_PERIOD' }
    const limit = Math.min(Math.max(1, Math.floor(Number(params.limit ?? 30))), 365)
    const conditions: string[] = ['s.cost_usd IS NOT NULL']
    const binds: unknown[] = []
    if (params.agentId != null && Number.isInteger(params.agentId)) {
      conditions.push('s.agent_id = ?')
      binds.push(params.agentId)
    }
    const where = conditions.join(' AND ')
    try {
      const rows = await queryLive(dbPath, `
        SELECT
          a.name as agent_name,
          s.agent_id,
          strftime('${periodFmt}', s.started_at) as period,
          COUNT(*) as session_count,
          ROUND(SUM(s.cost_usd), 4) as total_cost,
          ROUND(AVG(s.duration_ms) / 1000.0, 1) as avg_duration_s,
          SUM(s.num_turns) as total_turns,
          SUM(s.tokens_in + s.tokens_out) as total_tokens,
          SUM(s.tokens_cache_read) as cache_read,
          SUM(s.tokens_cache_write) as cache_write
        FROM sessions s
        JOIN agents a ON a.id = s.agent_id
        WHERE ${where}
        GROUP BY s.agent_id, strftime('${periodFmt}', s.started_at)
        ORDER BY period DESC
        LIMIT ?
      `, [...binds, limit])
      return { success: true, rows }
    } catch (err) {
      console.error('[IPC sessions:statsCost]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Paginated query for archived tasks — independent of refresh().
   * @param dbPath - Registered DB path
   * @param params - { page, pageSize, agentId?, perimetre? }
   * @returns {{ rows: Record<string,unknown>[], total: number }}
   */
  ipcMain.handle('tasks:getArchived', async (_event, dbPath: string, params: {
    page: number
    pageSize: number
    agentId?: number | null
    perimetre?: string | null
  }) => {
    assertDbPathAllowed(dbPath)
    const offset = params.page * params.pageSize
    const conditions: string[] = ["t.status = 'archived'"]
    const binds: unknown[] = []
    if (params.agentId != null) {
      conditions.push('t.agent_assigned_id = ?')
      binds.push(params.agentId)
    }
    if (params.perimetre != null) {
      conditions.push('t.scope = ?')
      binds.push(params.perimetre)
    }
    const where = conditions.join(' AND ')
    const [rows, countRows] = await Promise.all([
      queryLive(dbPath, `
        SELECT t.*, a.name as agent_name, a.scope as agent_scope,
          c.name as agent_creator_name
        FROM tasks t
        LEFT JOIN agents a ON a.id = t.agent_assigned_id
        LEFT JOIN agents c ON c.id = t.agent_creator_id
        WHERE ${where}
        ORDER BY t.updated_at DESC
        LIMIT ? OFFSET ?
      `, [...binds, params.pageSize, offset]),
      queryLive(dbPath, `SELECT COUNT(*) as total FROM tasks t WHERE ${where}`, binds)
    ])
    const total = (countRows[0] as Record<string, unknown>)?.total ?? 0
    return { rows, total: Number(total) }
  })

  /**
   * Quality stats per agent: total tasks, rejection count, rejection rate.
   * A "rejection" is detected when a task_comment from the reviewer (agent_id=4)
   * contains keywords: "rejet", "retour", "todo".
   * NOTE: heuristic-based; may miss non-standard rejection comments.
   * @param dbPath - Registered DB path
   * @param params - { perimetre?: string | null } optional filter by perimetre
   * @returns {{ success: boolean, rows: AgentQualityRow[], error?: string }}
   */
  ipcMain.handle('tasks:qualityStats', async (_event, dbPath: string, params?: {
    perimetre?: string | null
  }) => {
    assertDbPathAllowed(dbPath)
    const conditions: string[] = ["t.status IN ('done','archived')"]
    const binds: unknown[] = []
    if (params?.perimetre != null) {
      conditions.push('t.scope = ?')
      binds.push(params.perimetre)
    }
    const where = conditions.join(' AND ')
    try {
      const rows = await queryLive(dbPath, `
        SELECT
          a.id as agent_id,
          a.name as agent_name,
          a.scope as agent_scope,
          COUNT(DISTINCT t.id) as total_tasks,
          COUNT(DISTINCT CASE WHEN tc.id IS NOT NULL THEN t.id END) as rejected_tasks,
          ROUND(
            100.0 * COUNT(DISTINCT CASE WHEN tc.id IS NOT NULL THEN t.id END)
            / MAX(COUNT(DISTINCT t.id), 1),
            1
          ) as rejection_rate
        FROM agents a
        LEFT JOIN tasks t ON t.agent_assigned_id = a.id AND ${where}
        LEFT JOIN task_comments tc ON tc.task_id = t.id
          AND tc.agent_id = 4
          AND (tc.content LIKE '%rejet%' OR tc.content LIKE '%retour%' OR tc.content LIKE '%todo%')
        GROUP BY a.id, a.name, a.scope
        HAVING total_tasks > 0
        ORDER BY rejected_tasks DESC, total_tasks DESC
      `, binds)
      return { success: true, rows }
    } catch (err) {
      console.error('[IPC tasks:qualityStats]', err)
      return { success: false, error: String(err), rows: [] }
    }
  })

  /**
   * Update a task's status in the DB (used by drag & drop, etc.)
   * @param dbPath - Registered DB path
   * @param taskId - Task ID to update
   * @param status - New status: 'todo' | 'in_progress' | 'done' | 'archived'
   */
  const ALLOWED_TASK_STATUTS = ['todo', 'in_progress', 'done', 'archived'] as const
  ipcMain.handle('tasks:updateStatus', async (_event, dbPath: string, taskId: number, status: string) => {
    assertDbPathAllowed(dbPath)
    if (!ALLOWED_TASK_STATUTS.includes(status as typeof ALLOWED_TASK_STATUTS[number])) {
      return { success: false, error: `Invalid status: ${status}` }
    }
    try {
      if (status === 'in_progress') {
        const blockers = await queryLive(
          dbPath,
          `SELECT t.id, t.title, t.status
           FROM task_links tl JOIN tasks t ON t.id = tl.from_task
           WHERE tl.to_task = ? AND tl.type = 'blocks' AND t.status != 'archived'
           UNION
           SELECT t.id, t.title, t.status
           FROM task_links tl JOIN tasks t ON t.id = tl.to_task
           WHERE tl.from_task = ? AND tl.type = 'depends_on' AND t.status != 'archived'`,
          [taskId, taskId]
        ) as Array<{ id: number; title: string; status: string }>
        if (blockers.length) {
          return { success: false, error: 'TASK_BLOCKED', blockers }
        }
      }
      await writeDb(dbPath, (db) => {
        db.run(
          `UPDATE tasks SET status=?, updated_at=datetime('now') WHERE id=?`,
          [status, taskId]
        )
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC tasks:updateStatus]', err)
      return { success: false, error: String(err) }
    }
  })
}
