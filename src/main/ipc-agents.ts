/**
 * IPC handlers — Agent & session management
 *
 * Handles agent CRUD, session operations, prompt building, and task search.
 *
 * @module ipc-agents
 */

import { ipcMain } from 'electron'
import { readFile, writeFile, rename } from 'fs/promises'
import { join } from 'path'
import { assertDbPathAllowed, assertProjectPathAllowed, queryLive, writeDb } from './db'
import { insertAgentIntoClaudeMd } from './claude-md'

// ── Constants ────────────────────────────────────────────────────────────────

const STANDARD_AGENT_SUFFIX = [
  '---',
  'AGENT PROTOCOL REMINDER (mandatory — do not override):',
  '- On startup: read input session (sessions.summary) + open tasks from project.db',
  '- Before modifying a file: check locks, then INSERT OR REPLACE INTO locks',
  "- When taking a task: UPDATE tasks SET statut='in_progress'",
  "- When finishing a task: UPDATE tasks SET statut='done' + INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (?, ?, '<files changed · what was done · what remains>')",
  "- When ending session: release all locks + UPDATE sessions SET statut='completed', summary='Done:... Pending:... Next:...' (this IS the input session for next startup)",
  '- Never commit directly to main in multi-user mode',
  '- Never edit project.db manually',
].join('\n')

// ── Helpers ──────────────────────────────────────────────────────────────────

interface SearchFilters {
  statut?: string
  agent_id?: number
  perimetre?: string
}

// ── Handler registration ─────────────────────────────────────────────────────

/** Register all agent & session IPC handlers. */
export function registerAgentHandlers(): void {
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
          `UPDATE sessions SET statut='completed', ended_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
           WHERE statut='started'
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
   * Rename an agent in the database.
   * @param dbPath - Registered DB path
   * @param agentId - Agent ID to rename
   * @param newName - New agent name
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('rename-agent', async (_event, dbPath: string, agentId: number, newName: string) => {
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        db.run('UPDATE agents SET name = ? WHERE id = ?', [newName, agentId])
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC rename-agent]', err)
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
        db.run('UPDATE perimetres SET name = ?, description = ? WHERE id = ?', [newName, description || null, id])
        if (newName !== oldName) {
          db.run('UPDATE tasks SET perimetre = ? WHERE perimetre = ?', [newName, oldName])
          db.run('UPDATE agents SET perimetre = ? WHERE perimetre = ?', [newName, oldName])
        }
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC update-perimetre]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Update the system_prompt field for an agent.
   * @param dbPath - Registered DB path
   * @param agentId - Agent ID
   * @param systemPrompt - New system prompt content
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('update-agent-system-prompt', async (_event, dbPath: string, agentId: number, systemPrompt: string) => {
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        db.run('UPDATE agents SET system_prompt = ? WHERE id = ?', [systemPrompt || null, agentId])
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC update-agent-system-prompt]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Build the complete launch prompt for a Claude Code agent session.
   * Includes previous session summary and open task context if available.
   * @param agentName - Agent name
   * @param userPrompt - User-provided prompt text
   * @param dbPath - Optional DB path for context enrichment
   * @param agentId - Optional agent ID for context enrichment
   * @returns {string} Final prompt string
   */
  ipcMain.handle('build-agent-prompt', async (_event, agentName: string, userPrompt: string, dbPath?: string, agentId?: number) => {
    const HIDDEN_SUFFIX = `Tu es agent ${agentName}. Va voir ton prompt system dans la table agent.`
    const body = userPrompt && userPrompt.trim() ? `${userPrompt.trim()}\n\n` : ''
    const base = `${body}${HIDDEN_SUFFIX}`

    if (!dbPath || !agentId) return base

    try {
      const [sessionRows, taskRows] = await Promise.all([
        queryLive(
          dbPath,
          `SELECT summary FROM sessions
           WHERE agent_id = ? AND statut = 'completed' AND summary IS NOT NULL
           ORDER BY id DESC LIMIT 1`,
          [agentId]
        ) as Promise<Array<{ summary: string }>>,
        queryLive(
          dbPath,
          `SELECT id, titre, statut FROM tasks
           WHERE agent_assigne_id = ? AND statut IN ('todo','in_progress')
           ORDER BY id ASC LIMIT 5`,
          [agentId]
        ) as Promise<Array<{ id: number; titre: string; statut: string }>>
      ])

      const parts: string[] = []

      if (sessionRows.length > 0 && sessionRows[0].summary) {
        const summary = sessionRows[0].summary.slice(0, 120)
        parts.push(`Session préc.: ${summary}`)
      }

      if (taskRows.length > 0) {
        const taskList = taskRows.map(t => `#${t.id}[${t.statut}]`).join(' ')
        parts.push(`Tâches: ${taskList}`)
      }

      if (parts.length === 0) return base

      const contextPrefix = parts.join(' | ').slice(0, 300)
      return `${contextPrefix} -> ${base}`
    } catch {
      return base
    }
  })

  /**
   * Store the Claude Code conversation ID on the latest session for --resume support.
   * @param dbPath - Registered DB path
   * @param agentId - Agent ID
   * @param convId - Claude Code conversation UUID
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('session:setConvId', async (_event, dbPath: string, agentId: number, convId: string) => {
    if (!dbPath || typeof agentId !== 'number' || !convId) {
      return { success: false, error: 'Invalid arguments' }
    }
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        db.run(
          `UPDATE sessions SET claude_conv_id = ?
           WHERE id = (
             SELECT id FROM sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1
           )`,
          [convId, agentId]
        )
      })
      console.log(`[IPC session:setConvId] agent=${agentId} conv_id=${convId}`)
      return { success: true }
    } catch (err) {
      console.error('[IPC session:setConvId]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Fetch system_prompt, system_prompt_suffix, thinking_mode, and permission_mode for an agent.
   * @param dbPath - DB path
   * @param agentId - Agent ID
   * @returns {{ success: boolean, systemPrompt: string|null, systemPromptSuffix: string|null, thinkingMode: string|null, permissionMode: string|null }}
   */
  ipcMain.handle('get-agent-system-prompt', async (_event, dbPath: string, agentId: number) => {
    try {
      const rows = await queryLive(
        dbPath,
        'SELECT system_prompt, system_prompt_suffix, thinking_mode, permission_mode FROM agents WHERE id = ?',
        [agentId]
      )
      if (rows.length === 0) {
        return { success: false, error: 'Agent not found', systemPrompt: null, systemPromptSuffix: null, thinkingMode: null, permissionMode: null }
      }
      const row = rows[0] as { system_prompt: string | null; system_prompt_suffix: string | null; thinking_mode: string | null; permission_mode: string | null }
      return {
        success: true,
        systemPrompt: row.system_prompt,
        systemPromptSuffix: row.system_prompt_suffix,
        thinkingMode: row.thinking_mode,
        permissionMode: row.permission_mode
      }
    } catch (err) {
      console.error('[IPC get-agent-system-prompt]', err)
      return { success: false, error: String(err), systemPrompt: null, systemPromptSuffix: null, thinkingMode: null, permissionMode: null }
    }
  })

  /**
   * Set thinking_mode for an agent.
   * @param dbPath - Registered DB path
   * @param agentId - Agent ID
   * @param thinkingMode - 'auto', 'disabled', or null (auto)
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('update-agent-thinking-mode', async (_event, dbPath: string, agentId: number, thinkingMode: string | null) => {
    if (thinkingMode !== null && thinkingMode !== 'auto' && thinkingMode !== 'disabled') {
      return { success: false, error: `Invalid thinkingMode value: '${thinkingMode}'. Accepted: 'auto', 'disabled', null` }
    }
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        db.run('UPDATE agents SET thinking_mode = ? WHERE id = ?', [thinkingMode || null, agentId])
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC update-agent-thinking-mode]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Bulk update agent fields (name, type, perimetre, thinkingMode, etc.).
   * @param dbPath - Registered DB path
   * @param agentId - Agent ID
   * @param updates - Partial agent fields to update
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('update-agent', async (_event, dbPath: string, agentId: number, updates: {
    name?: string
    type?: string
    perimetre?: string | null
    thinkingMode?: string | null
    allowedTools?: string | null
    systemPrompt?: string | null
    systemPromptSuffix?: string | null
    autoLaunch?: boolean
    permissionMode?: 'default' | 'auto' | null
    maxSessions?: number
  }) => {
    if (updates.maxSessions !== undefined) {
      if (!Number.isInteger(updates.maxSessions) || updates.maxSessions < 1) {
        return { success: false, error: `Invalid maxSessions value: ${updates.maxSessions}. Must be an integer >= 1.` }
      }
    }
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        if (updates.name !== undefined) {
          db.run('UPDATE agents SET name = ? WHERE id = ?', [updates.name, agentId])
        }
        if (updates.type !== undefined) {
          db.run('UPDATE agents SET type = ? WHERE id = ?', [updates.type, agentId])
        }
        if (updates.perimetre !== undefined) {
          db.run('UPDATE agents SET perimetre = ? WHERE id = ?', [updates.perimetre || null, agentId])
        }
        if (updates.thinkingMode !== undefined) {
          db.run('UPDATE agents SET thinking_mode = ? WHERE id = ?', [updates.thinkingMode || null, agentId])
        }
        if (updates.allowedTools !== undefined) {
          db.run('UPDATE agents SET allowed_tools = ? WHERE id = ?', [updates.allowedTools || null, agentId])
        }
        if (updates.systemPrompt !== undefined) {
          db.run('UPDATE agents SET system_prompt = ? WHERE id = ?', [updates.systemPrompt || null, agentId])
        }
        if (updates.systemPromptSuffix !== undefined) {
          db.run('UPDATE agents SET system_prompt_suffix = ? WHERE id = ?', [updates.systemPromptSuffix || null, agentId])
        }
        if (updates.autoLaunch !== undefined) {
          db.run('UPDATE agents SET auto_launch = ? WHERE id = ?', [updates.autoLaunch ? 1 : 0, agentId])
        }
        if (updates.permissionMode !== undefined) {
          db.run('UPDATE agents SET permission_mode = ? WHERE id = ?', [updates.permissionMode || null, agentId])
        }
        if (updates.maxSessions !== undefined) {
          db.run('UPDATE agents SET max_sessions = ? WHERE id = ?', [updates.maxSessions, agentId])
        }
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC update-agent]', err)
      return { success: false, error: String(err) }
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
   * Syncs tasks.agent_assigne_id: role='primary' takes precedence, else first assignee, else NULL.
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
        // Sync tasks.agent_assigne_id: primary > first > NULL
        const primary = assignees.find(a => a.role === 'primary')
        const newAssigne = primary?.agentId ?? assignees[0]?.agentId ?? null
        db.run('UPDATE tasks SET agent_assigne_id = ? WHERE id = ?', [newAssigne, taskId])
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC task:setAssignees]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Full-text search tasks with optional filters (statut, agent_id, perimetre).
   * @param dbPath - DB path
   * @param query - Search text (LIKE match on titre/description)
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
      const conditions: string[] = []
      const params: unknown[] = []

      if (query && query.trim()) {
        const q = `%${query.trim()}%`
        conditions.push('(t.titre LIKE ? OR t.description LIKE ?)')
        params.push(q, q)
      }

      if (filters?.statut) {
        conditions.push('t.statut = ?')
        params.push(filters.statut)
      }
      if (filters?.agent_id) {
        conditions.push('t.agent_assigne_id = ?')
        params.push(filters.agent_id)
      }
      if (filters?.perimetre) {
        conditions.push('t.perimetre = ?')
        params.push(filters.perimetre)
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // PERF: LIKE %...% requires a full table scan (no index usable on leading wildcard).
      // LIMIT 20 caps results early; the scan still touches all rows but avoids large
      // result payloads. For proper fix: add an FTS5 virtual table on titre+description.
      const sql = `
        SELECT
          t.id,
          t.titre,
          t.statut,
          t.perimetre,
          t.updated_at,
          t.description,
          SUBSTR(t.description, 1, 100) as description_excerpt,
          a.name as agent_assigne
        FROM tasks t
        LEFT JOIN agents a ON a.id = t.agent_assigne_id
        ${whereClause}
        ORDER BY t.updated_at DESC
        LIMIT 20
      `

      const rows = await queryLive(dbPath, sql, params)
      return { success: true, results: rows }
    } catch (err) {
      console.error('[IPC search-tasks]', err)
      return { success: false, error: String(err), results: [] }
    }
  })

  /**
   * Delete an agent if it has no associated history (sessions, tasks, comments, logs).
   * @param dbPath - Registered DB path
   * @param agentId - Agent ID to delete
   * @returns {{ success: boolean, hasHistory?: boolean, error?: string }}
   *   hasHistory=true means deletion was blocked (agent has history)
   */
  ipcMain.handle('delete-agent', async (_event, dbPath: string, agentId: number) => {
    if (typeof agentId !== 'number' || !Number.isInteger(agentId)) {
      return { success: false, error: 'Invalid agentId' }
    }
    try {
      assertDbPathAllowed(dbPath)
      const historyRows = await queryLive(
        dbPath,
        `SELECT (
          (SELECT COUNT(*) FROM sessions WHERE agent_id = ?) +
          (SELECT COUNT(*) FROM tasks WHERE agent_assigne_id = ?) +
          (SELECT COUNT(*) FROM task_comments WHERE agent_id = ?) +
          (SELECT COUNT(*) FROM agent_logs WHERE agent_id = ?)
        ) as history_count`,
        [agentId, agentId, agentId, agentId]
      ) as Array<{ history_count: number }>

      if ((historyRows[0]?.history_count ?? 0) > 0) {
        return { success: true, hasHistory: true }
      }

      await writeDb(dbPath, (db) => {
        db.run(
          "UPDATE locks SET released_at = datetime('now') WHERE agent_id = ? AND released_at IS NULL",
          [agentId]
        )
        db.run('DELETE FROM agents WHERE id = ?', [agentId])
      })
      return { success: true, hasHistory: false }
    } catch (err) {
      console.error('[IPC delete-agent]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Insert a new perimeter into the perimetres table.
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
        db.run('INSERT INTO perimetres (name) VALUES (?)', [name.trim()])
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
   * Create a new agent and optionally insert it into CLAUDE.md.
   * @param dbPath - Registered DB path
   * @param projectPath - Project root (for CLAUDE.md update)
   * @param data - Agent definition (name, type, perimetre, thinkingMode, systemPrompt, description)
   * @returns {{ success: boolean, agentId?: number, claudeMdUpdated?: boolean, error?: string }}
   */
  ipcMain.handle('create-agent', async (
    _event,
    dbPath: string,
    projectPath: string,
    data: { name: string; type: string; perimetre: string | null; thinkingMode: string | null; systemPrompt: string | null; description: string }
  ) => {
    try {
      assertDbPathAllowed(dbPath)
      assertProjectPathAllowed(projectPath)

      const agentId = await writeDb<number>(dbPath, (db) => {
        db.run(
          'INSERT INTO agents (name, type, perimetre, thinking_mode, system_prompt, system_prompt_suffix) VALUES (?, ?, ?, ?, ?, ?)',
          [data.name, data.type, data.perimetre ?? null, data.thinkingMode ?? null, data.systemPrompt ?? null, STANDARD_AGENT_SUFFIX]
        )
        const rows = db.exec('SELECT last_insert_rowid() as id')
        return rows[0].values[0][0] as number
      })

      let claudeMdUpdated = false
      try {
        const claudeMdPath = join(projectPath, 'CLAUDE.md')
        const claudeMdContent = await readFile(claudeMdPath, 'utf-8')
        const updated = insertAgentIntoClaudeMd(claudeMdContent, data.type, data.name, data.description)
        if (updated !== claudeMdContent) {
          const tmpPath = claudeMdPath + '.tmp'
          await writeFile(tmpPath, updated, 'utf-8')
          await rename(tmpPath, claudeMdPath)
          claudeMdUpdated = true
        }
      } catch (claudeErr) {
        console.warn('[IPC create-agent] CLAUDE.md update skipped:', claudeErr)
      }

      return { success: true, agentId, claudeMdUpdated }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        return { success: false, error: `Un agent nommé "${data.name}" existe déjà` }
      }
      console.error('[IPC create-agent]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Duplicate an agent — copies all fields and generates a unique name (<name>-copy, or -copy-2, etc.)
   * @param dbPath - Registered DB path
   * @param agentId - ID of the agent to duplicate
   * @returns {{ success: boolean, agentId?: number, name?: string, error?: string }}
   */
  ipcMain.handle('agent:duplicate', async (_event, dbPath: string, agentId: number) => {
    try {
      assertDbPathAllowed(dbPath)
      const result = await writeDb<{ id: number; name: string }>(dbPath, (db) => {
        const rows = db.exec(`SELECT name, type, perimetre, thinking_mode, system_prompt, system_prompt_suffix, allowed_tools FROM agents WHERE id = ${agentId}`)
        if (!rows.length || !rows[0].values.length) throw new Error('Agent not found')
        const [name, type, perimetre, thinkingMode, systemPrompt, systemPromptSuffix, allowedTools] = rows[0].values[0]

        // Generate unique name: <name>-copy, then -copy-2, -copy-3, …
        const baseName = `${name}-copy`
        const existingRows = db.exec(`SELECT name FROM agents WHERE name LIKE '${baseName.replace(/'/g, "''")}%'`)
        const existing = new Set<string>(existingRows.length ? existingRows[0].values.map(r => r[0] as string) : [])
        let newName = baseName
        let n = 2
        while (existing.has(newName)) {
          newName = `${baseName}-${n++}`
        }

        db.run(
          'INSERT INTO agents (name, type, perimetre, thinking_mode, system_prompt, system_prompt_suffix, allowed_tools, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
          [newName, type, perimetre, thinkingMode, systemPrompt, systemPromptSuffix, allowedTools]
        )
        const idRows = db.exec('SELECT last_insert_rowid() as id')
        const newId = idRows[0].values[0][0] as number
        return { id: newId, name: newName }
      })
      return { success: true, agentId: result.id, name: result.name }
    } catch (err) {
      console.error('[IPC agent:duplicate]', err)
      return { success: false, error: String(err) }
    }
  })
}
