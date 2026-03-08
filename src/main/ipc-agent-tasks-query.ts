/**
 * IPC handlers — Task query & search operations
 *
 * Handles task assignees lookup, full-text search, and dependency link queries.
 *
 * Extracted from ipc-agent-tasks.ts (T1131) to keep file size under 400 lines.
 *
 * @module ipc-agent-tasks-query
 */

import { ipcMain } from 'electron'
import { assertDbPathAllowed, queryLive } from './db'

// ── Helpers ──────────────────────────────────────────────────────────────────

interface SearchFilters {
  status?: string
  statut?: string
  agent_id?: number
  scope?: string
  perimetre?: string
}

// ── Handler registration ─────────────────────────────────────────────────────

/** Register task query IPC handlers. */
export function registerAgentTaskQueryHandlers(): void {
  /**
   * Fetch all agents assigned to a task from task_agents.
   * @param dbPath - DB path
   * @param taskId - Task ID
   * @returns {{ success: boolean, assignees: Array<{ agent_id, agent_name, role, assigned_at }>, error?: string }}
   */
  ipcMain.handle('task:getAssignees', async (_event, dbPath: string, taskId: number) => {
    if (typeof taskId !== 'number' || !Number.isInteger(taskId)) {
      return { success: false, assignees: [], error: 'Invalid taskId' }
    }
    try {
      assertDbPathAllowed(dbPath)
      const rows = await queryLive(
        dbPath,
        `SELECT ta.agent_id, a.name as agent_name, ta.role, ta.assigned_at
         FROM task_agents ta
         JOIN agents a ON a.id = ta.agent_id
         WHERE ta.task_id = ?
         ORDER BY ta.assigned_at ASC`,
        [taskId]
      )
      return { success: true, assignees: rows }
    } catch (err) {
      console.error('[IPC task:getAssignees]', err)
      return { success: false, assignees: [], error: String(err) }
    }
  })

  /**
   * Full-text search tasks with optional filters (status, agent_id, scope).
   * @param dbPath - DB path
   * @param query - Search text (LIKE match on title/description)
   * @param filters - Optional filters
   * @returns {{ success: boolean, results: Array, error?: string }}
   */
  ipcMain.handle('search-tasks', async (
    _event,
    dbPath: string,
    query: string,
    filters?: SearchFilters
  ) => {
    try {
      assertDbPathAllowed(dbPath)

      const trimmed = query?.trim() ?? ''
      const useFts = trimmed.length > 0
      const filterConditions: string[] = []
      const filterParams: unknown[] = []

      if (filters?.status ?? filters?.statut) {
        filterConditions.push('t.status = ?')
        filterParams.push(filters?.status ?? filters?.statut)
      }
      if (filters?.agent_id) {
        filterConditions.push('t.agent_assigned_id = ?')
        filterParams.push(filters.agent_id)
      }
      if (filters?.scope ?? filters?.perimetre) {
        filterConditions.push('t.scope = ?')
        filterParams.push(filters?.scope ?? filters?.perimetre)
      }

      if (useFts) {
        // FTS4 MATCH query — sanitize input to avoid FTS syntax errors
        const ftsQuery = trimmed
          .replace(/[+\-*"()^]/g, ' ')
          .split(/\s+/)
          .filter(Boolean)
          .map(token => `"${token}"`)
          .join(' ')

        const ftsWhere = filterConditions.length > 0
          ? `AND ${filterConditions.join(' AND ')}`
          : ''

        const sql = `
          SELECT
            t.id,
            t.title,
            t.status,
            t.scope,
            t.updated_at,
            t.description,
            SUBSTR(t.description, 1, 100) as description_excerpt,
            a.name as agent_assigne
          FROM tasks_fts f
          JOIN tasks t ON t.id = f.rowid
          LEFT JOIN agents a ON a.id = t.agent_assigned_id
          WHERE tasks_fts MATCH ?
          ${ftsWhere}
          ORDER BY t.updated_at DESC
          LIMIT 20
        `
        try {
          const rows = await queryLive(dbPath, sql, [ftsQuery, ...filterParams])
          return { success: true, results: rows }
        } catch {
          // FTS table not available (pre-migration DB) — fall back to LIKE
          const q = `%${trimmed}%`
          const fallbackWhere = `WHERE (t.title LIKE ? OR t.description LIKE ?)${filterConditions.length > 0 ? ` AND ${filterConditions.join(' AND ')}` : ''}`
          const fallbackSql = `
            SELECT
              t.id,
              t.title,
              t.status,
              t.scope,
              t.updated_at,
              t.description,
              SUBSTR(t.description, 1, 100) as description_excerpt,
              a.name as agent_assigne
            FROM tasks t
            LEFT JOIN agents a ON a.id = t.agent_assigned_id
            ${fallbackWhere}
            ORDER BY t.updated_at DESC
            LIMIT 20
          `
          const rows = await queryLive(dbPath, fallbackSql, [q, q, ...filterParams])
          return { success: true, results: rows }
        }
      }

      const whereClause = filterConditions.length > 0
        ? `WHERE ${filterConditions.join(' AND ')}`
        : ''

      const sql = `
        SELECT
          t.id,
          t.title,
          t.status,
          t.scope,
          t.updated_at,
          t.description,
          SUBSTR(t.description, 1, 100) as description_excerpt,
          a.name as agent_assigne
        FROM tasks t
        LEFT JOIN agents a ON a.id = t.agent_assigned_id
        ${whereClause}
        ORDER BY t.updated_at DESC
        LIMIT 20
      `

      const rows = await queryLive(dbPath, sql, filterParams)
      return { success: true, results: rows }
    } catch (err) {
      console.error('[IPC search-tasks]', err)
      return { success: false, error: String(err), results: [] }
    }
  })

  /**
   * Fetch all dependency links for a task from task_links.
   * Returns links where the task is source or target, joined with task titles and statuses.
   * @param dbPath - DB path
   * @param taskId - Task ID
   * @returns {{ success: boolean, links: TaskLink[], error?: string }}
   */
  ipcMain.handle('task:getLinks', async (_event, dbPath: string, taskId: number) => {
    if (typeof taskId !== 'number' || !Number.isInteger(taskId)) {
      return { success: false, links: [], error: 'Invalid taskId' }
    }
    assertDbPathAllowed(dbPath)
    try {
      const rows = await queryLive(
        dbPath,
        `SELECT tl.id, tl.type, tl.from_task, tl.to_task,
          tf.title as from_title, tf.status as from_status,
          tt.title as to_title, tt.status as to_status
         FROM task_links tl
         JOIN tasks tf ON tf.id = tl.from_task
         JOIN tasks tt ON tt.id = tl.to_task
         WHERE tl.from_task = ? OR tl.to_task = ?`,
        [taskId, taskId]
      )
      return { success: true, links: rows }
    } catch (err) {
      console.error('[IPC task:getLinks]', err)
      return { success: false, links: [], error: String(err) }
    }
  })
}
