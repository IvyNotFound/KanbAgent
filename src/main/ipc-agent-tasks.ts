/**
 * IPC handlers — Task & perimeter management (CRUD/mutation)
 *
 * Handles task assignee updates, session closing, perimeter CRUD, and prompt building.
 * Query handlers (search, getAssignees, getLinks) are in ipc-agent-tasks-query.ts.
 *
 * @module ipc-agent-tasks
 */

import { ipcMain } from 'electron'
import { assertDbPathAllowed, writeDb, writeDbNative } from './db'
import { registerAgentTaskQueryHandlers } from './ipc-agent-tasks-query'
import { PositiveIdSchema, AgentDisplayNameSchema } from '../shared/ipc-schemas'

// ── Handler registration ─────────────────────────────────────────────────────

/** Register task & perimeter IPC handlers. */
export function registerAgentTaskHandlers(): void {
  // Register query handlers from split module
  registerAgentTaskQueryHandlers()

  /**
   * Mark all started sessions as completed for a given agent.
   * @param dbPath - Registered DB path
   * @param agentName - Agent name to close sessions for
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('close-agent-sessions', async (_event, dbPath: string, agentName: string) => {
    if (!AgentDisplayNameSchema.safeParse(agentName).success) {
      return { success: false, error: 'Invalid agentName: must be a non-empty string (max 200 chars)' }
    }
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
    if (!PositiveIdSchema.safeParse(id).success) {
      return { success: false, error: 'Invalid id: must be a positive integer' }
    }
    if (!AgentDisplayNameSchema.safeParse(newName).success) {
      return { success: false, error: 'Invalid newName: must be a non-empty string (max 200 chars)' }
    }
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

      const contextBlock = await writeDbNative(dbPath, (db) => {
        // Get agent info
        const agent = db.prepare('SELECT name, type, scope FROM agents WHERE id = ?').get(agentId) as { name: string; type: string | null; scope: string | null } | undefined
        if (!agent) return null
        const { name, type, scope } = agent

        // Create session (conv_id set later by session:setConvId when system:init arrives)
        const insertResult = db.prepare('INSERT INTO sessions (agent_id) VALUES (?)').run(agentId)
        const sessionId = insertResult.lastInsertRowid as number

        // Last completed session summary
        const prevRow = db.prepare(
          "SELECT summary FROM sessions WHERE agent_id = ? AND status = 'completed' AND summary IS NOT NULL ORDER BY id DESC LIMIT 1"
        ).get(agentId) as { summary: string | null } | undefined
        const prevSummary = prevRow?.summary ?? null

        // Open tasks
        const taskRows = db.prepare(
          "SELECT id, status, scope, priority, title FROM tasks WHERE agent_assigned_id = ? AND status IN ('todo', 'in_progress') ORDER BY status DESC, updated_at DESC"
        ).all(agentId) as Array<{ id: number; status: string; scope: string | null; priority: string; title: string }>

        // Format all queried data into a structured context block for agent startup:
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

        if (taskRows.length === 0) {
          lines.push('(aucune tâche todo / in_progress)')
        } else {
          for (const { id, status: taskStatus, scope: taskScope, priority, title } of taskRows) {
            lines.push(`[T${id}] ${taskStatus} | ${taskScope ?? '-'} | prio:${priority} | ${title}`)
          }
        }

        return lines.join('\n')
      })

      // Prefix the user prompt with the context block, separated by "---"; return bare prompt on failure:
      if (!contextBlock) return base
      return base ? `${contextBlock}\n---\n${base}` : contextBlock
    } catch {
      return base
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
        const stmt = db.prepare('INSERT INTO task_agents (task_id, agent_id, role) VALUES (?, ?, ?)')
        for (const a of assignees) {
          stmt.run([taskId, a.agentId, a.role ?? null])
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
}
