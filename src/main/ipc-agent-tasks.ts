/**
 * IPC handlers — Task & perimeter management
 *
 * Handles task assignees, search, links, prompt building, and perimeter CRUD.
 *
 * @module ipc-agent-tasks
 */

import { ipcMain } from 'electron'
import { assertDbPathAllowed, queryLive, writeDb } from './db'

// ── Helpers ──────────────────────────────────────────────────────────────────

interface SearchFilters {
  status?: string
  statut?: string
  agent_id?: number
  scope?: string
  perimetre?: string
}

// ── Handler registration ─────────────────────────────────────────────────────

/** Register task & perimeter IPC handlers. */
export function registerAgentTaskHandlers(): void {
  /**
   * Mark all started sessions as completed for a given agent.
   * @param dbPath - Registered DB path
   * @param agentName - Agent name to close sessions for
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('close-agent-sessions', async (_event, dbPath: string, agentName: string) => {
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        db.run(
          `UPDATE sessions SET status='completed', ended_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
           WHERE status='started'
             AND agent_id=(SELECT id FROM agents WHERE name=?)`,
          [agentName]
        )
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC close-agent-sessions]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Update perimeter name/description and cascade rename to tasks and agents.
   * @param dbPath - Registered DB path
   * @param id - Perimeter ID
   * @param oldName - Current perimeter name (for cascade)
   * @param newName - New perimeter name
   * @param description - New description
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('update-perimetre', async (_event, dbPath: string, id: number, oldName: string, newName: string, description: string) => {
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        db.run('UPDATE scopes SET name = ?, description = ? WHERE id = ?', [newName, description || null, id])
        if (newName !== oldName) {
          db.run('UPDATE tasks SET scope = ? WHERE scope = ?', [newName, oldName])
          db.run('UPDATE agents SET scope = ? WHERE scope = ?', [newName, oldName])
        }
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC update-perimetre]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Build the complete launch prompt for a Claude Code agent session.
   * Creates a DB session and injects the startup context block (identifiers,
   * previous session summary, assigned tasks, active locks) directly into the
   * first user message — so the agent receives all context without needing to
   * call dbstart.js itself.
   *
   * Format returned: "<context block>\n---\n<userPrompt>" or just "<userPrompt>"
   * when no dbPath/agentId is provided (fallback).
   *
   * @param agentName - Agent name (unused, kept for API compatibility)
   * @param userPrompt - User-provided prompt text (e.g. "T866")
   * @param dbPath - Optional DB path
   * @param agentId - Optional agent ID
   * @returns {string} Final prompt string
   */
  ipcMain.handle('build-agent-prompt', async (_event, _agentName: string, userPrompt: string, dbPath?: string, agentId?: number) => {
    const base = userPrompt?.trim() ?? ''

    if (!dbPath || !agentId) return base

    try {
      assertDbPathAllowed(dbPath)

      const contextBlock = await writeDb(dbPath, (db) => {
        // Get agent info
        const agentRows = db.exec(`SELECT name, type, scope FROM agents WHERE id = ${agentId}`)
        if (!agentRows.length || !agentRows[0].values.length) return null
        const [name, type, scope] = agentRows[0].values[0] as [string, string | null, string | null]

        // Create session (claude_conv_id set later by session:setConvId when system:init arrives)
        db.run(`INSERT INTO sessions (agent_id) VALUES (${agentId})`)
        const sessionRows = db.exec('SELECT last_insert_rowid()')
        const sessionId = sessionRows[0].values[0][0] as number

        // Last completed session summary
        const prevRows = db.exec(`
          SELECT summary FROM sessions
          WHERE agent_id = ${agentId} AND status = 'completed' AND summary IS NOT NULL
          ORDER BY id DESC LIMIT 1
        `)
        const prevSummary = prevRows.length && prevRows[0].values.length
          ? (prevRows[0].values[0][0] as string | null)
          : null

        // Open tasks
        const taskRows = db.exec(`
          SELECT id, status, scope, priority, title
          FROM tasks
          WHERE agent_assigned_id = ${agentId} AND status IN ('todo', 'in_progress')
          ORDER BY status DESC, updated_at DESC
        `)

        // Active locks
        const lockRows = db.exec(`
          SELECT l.file, a.name FROM locks l
          JOIN agents a ON a.id = l.agent_id
          WHERE l.released_at IS NULL
        `)

        const lines: string[] = [
          '=== IDENTIFIANTS ===',
          `agent: ${name} (type:${type ?? '-'} | périmètre:${scope ?? '-'})`,
          `agent_id: ${agentId}`,
          `session_id: ${sessionId}`,
          '',
          '=== SESSION PRÉCÉDENTE ===',
          prevSummary ?? '(aucune session completed)',
          '',
          '=== TÂCHES ASSIGNÉES ===',
        ]

        if (!taskRows.length || !taskRows[0].values.length) {
          lines.push('(aucune tâche todo / in_progress)')
        } else {
          for (const [id, taskStatus, taskScope, priority, title] of taskRows[0].values as [number, string, string, string, string][]) {
            lines.push(`[T${id}] ${taskStatus} | ${taskScope ?? '-'} | prio:${priority} | ${title}`)
          }
        }

        lines.push('', '=== LOCKS ACTIFS ===')
        if (!lockRows.length || !lockRows[0].values.length) {
          lines.push('(aucun)')
        } else {
          for (const [file, owner] of lockRows[0].values as [string, string][]) {
            lines.push(`${file} → ${owner}`)
          }
        }

        return lines.join('\n')
      })

      if (!contextBlock) return base
      return base ? `${contextBlock}\n---\n${base}` : contextBlock
    } catch {
      return base
    }
  })

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
   * Atomically replace all assignees for a task in task_agents.
   * Syncs tasks.agent_assigned_id: role='primary' takes precedence, else first assignee, else NULL.
   * @param dbPath - Registered DB path
   * @param taskId - Task ID
   * @param assignees - Array of { agentId, role? } to set
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('task:setAssignees', async (
    _event,
    dbPath: string,
    taskId: number,
    assignees: Array<{ agentId: number; role?: string | null }>
  ) => {
    if (typeof taskId !== 'number' || !Number.isInteger(taskId)) {
      return { success: false, error: 'Invalid taskId' }
    }
    if (!Array.isArray(assignees)) {
      return { success: false, error: 'assignees must be an array' }
    }
    const validRoles = new Set([null, undefined, 'primary', 'support', 'reviewer'])
    for (const a of assignees) {
      if (typeof a.agentId !== 'number' || !Number.isInteger(a.agentId)) {
        return { success: false, error: `Invalid agentId: ${a.agentId}` }
      }
      if (!validRoles.has(a.role)) {
        return { success: false, error: `Invalid role: '${a.role}'. Accepted: primary, support, reviewer, null` }
      }
    }
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        db.run('DELETE FROM task_agents WHERE task_id = ?', [taskId])
        for (const a of assignees) {
          db.run(
            'INSERT INTO task_agents (task_id, agent_id, role) VALUES (?, ?, ?)',
            [taskId, a.agentId, a.role ?? null]
          )
        }
        // Sync tasks.agent_assigned_id: primary > first > NULL
        const primary = assignees.find(a => a.role === 'primary')
        const newAssigne = primary?.agentId ?? assignees[0]?.agentId ?? null
        db.run('UPDATE tasks SET agent_assigned_id = ? WHERE id = ?', [newAssigne, taskId])
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC task:setAssignees]', err)
      return { success: false, error: String(err) }
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
   * Insert a new scope into the scopes table.
   * @param dbPath - Registered DB path
   * @param name - Perimeter name (must be unique)
   * @returns {{ success: boolean, id?: number, error?: string }}
   */
  ipcMain.handle('add-perimetre', async (_event, dbPath: string, name: string) => {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { success: false, error: 'Invalid perimeter name' }
    }
    try {
      assertDbPathAllowed(dbPath)
      const id = await writeDb<number>(dbPath, (db) => {
        db.run('INSERT INTO scopes (name) VALUES (?)', [name.trim()])
        const rows = db.exec('SELECT last_insert_rowid() as id')
        return rows[0].values[0][0] as number
      })
      return { success: true, id }
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        return { success: false, error: `Un périmètre nommé "${name}" existe déjà` }
      }
      console.error('[IPC add-perimetre]', err)
      return { success: false, error: String(err) }
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
