/**
 * IPC handlers — Agent & session management
 *
 * Handles agent CRUD, session operations, prompt building, and task search.
 *
 * @module ipc-agents
 */

import { ipcMain } from 'electron'
import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import { writeFile, rename } from 'fs/promises'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { assertDbPathAllowed, assertProjectPathAllowed, queryLive, writeDb } from './db'
import { insertAgentIntoClaudeMd } from './claude-md'

// ── Constants ────────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

// ── Token parsing helpers (T518) ──────────────────────────────────────────────

interface TokenCounts {
  tokensIn: number
  tokensOut: number
  cacheRead: number
  cacheWrite: number
}

/**
 * Derive Claude Code's project slug from a WSL project path.
 * e.g. '/mnt/c/Users/foo/project' → '-mnt-c-Users-foo-project'
 */
function claudeProjectSlug(projectPath: string): string {
  return projectPath.replace(/\//g, '-')
}

/**
 * T518: Parse token usage from a Claude Code conversation JSONL file.
 * Sums tokens across all finalized assistant messages (stop_reason != null).
 * Each API call generates 2 JSONL entries with the same requestId:
 *   - streaming start (stop_reason: null, output_tokens ~1)
 *   - final message  (stop_reason: e.g. 'tool_use', full output_tokens)
 * Only the final entry is counted to avoid double-counting.
 *
 * @param projectPath - WSL project path (e.g. '/mnt/c/Users/foo/project')
 * @param convId - Claude Code conversation UUID
 */
async function parseConvTokens(projectPath: string, convId: string): Promise<TokenCounts> {
  const slug = claudeProjectSlug(projectPath)
  const jsonlPath = join(homedir(), '.claude', 'projects', slug, `${convId}.jsonl`)

  let tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheWrite = 0

  await new Promise<void>((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(jsonlPath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const obj = JSON.parse(line)
        // Only count finalized assistant messages (stop_reason != null = streaming start only)
        if (obj.type !== 'assistant') return
        if (!obj.message?.usage || obj.message.stop_reason == null) return
        const u = obj.message.usage
        tokensIn  += (u.input_tokens                ?? 0)
        tokensOut += (u.output_tokens               ?? 0)
        cacheRead += (u.cache_read_input_tokens      ?? 0)
        cacheWrite += (u.cache_creation_input_tokens ?? 0)
      } catch { /* malformed line — skip */ }
    })
    rl.on('close', resolve)
    rl.on('error', reject)
  })

  return { tokensIn, tokensOut, cacheRead, cacheWrite }
}

/**
 * Derive WSL project path from a db path.
 * e.g. '/mnt/c/Users/foo/project/.claude/project.db' → '/mnt/c/Users/foo/project'
 */
function projectPathFromDb(dbPath: string): string {
  return dirname(dirname(dbPath))
}

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
  ipcMain.handle('build-agent-prompt', async (_event, _agentName: string, userPrompt: string, dbPath?: string, agentId?: number) => {
    const base = userPrompt?.trim() ?? ''

    if (!dbPath || !agentId) return base

    try {
      assertDbPathAllowed(dbPath)
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
      return base ? `${contextPrefix} -> ${base}` : contextPrefix
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
      const rowsModified = await writeDb<number>(dbPath, (db) => {
        db.run(
          `UPDATE sessions SET claude_conv_id = ?
           WHERE id = (
             SELECT id FROM sessions
             WHERE agent_id = ? AND statut = 'started' AND claude_conv_id IS NULL
             ORDER BY id DESC LIMIT 1
           )`,
          [convId, agentId]
        )
        return db.getRowsModified() as number
      })
      console.log(`[IPC session:setConvId] agent=${agentId} conv_id=${convId} updated=${rowsModified}`)
      return { success: true, updated: rowsModified > 0 }
    } catch (err) {
      console.error('[IPC session:setConvId]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * T518: Parse token usage from a completed Claude Code session JSONL and persist to DB.
   * Reads ~/.claude/projects/<slug>/<convId>.jsonl, sums finalized assistant messages,
   * and updates sessions.tokens_* WHERE claude_conv_id = convId.
   *
   * @param dbPath - Registered DB path
   * @param convId - Claude Code conversation UUID
   * @param projectPath - WSL project path (derived from dbPath if omitted)
   */
  ipcMain.handle('session:parseTokens', async (_event, dbPath: string, convId: string, projectPath?: string) => {
    if (!dbPath || !convId) return { success: false, error: 'Invalid arguments' }
    if (!UUID_REGEX.test(convId)) return { success: false, error: 'Invalid convId format' }
    try {
      assertDbPathAllowed(dbPath)
      const resolvedProjectPath = projectPath ?? projectPathFromDb(dbPath)
      const counts = await parseConvTokens(resolvedProjectPath, convId)
      await writeDb(dbPath, (db) => {
        db.run(
          `UPDATE sessions
           SET tokens_in = ?, tokens_out = ?, tokens_cache_read = ?, tokens_cache_write = ?
           WHERE claude_conv_id = ?`,
          [counts.tokensIn, counts.tokensOut, counts.cacheRead, counts.cacheWrite, convId]
        )
      })
      console.log(`[IPC session:parseTokens] conv=${convId} in=${counts.tokensIn} out=${counts.tokensOut}`)
      return { success: true, ...counts }
    } catch (err) {
      console.error('[IPC session:parseTokens]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * T518: Retroactively sync token counts for all sessions that have a claude_conv_id
   * but zero tokens. Useful for populating data from sessions started before T518.
   *
   * @param dbPath - Registered DB path
   * @param projectPath - WSL project path (derived from dbPath if omitted)
   */
  ipcMain.handle('session:syncAllTokens', async (_event, dbPath: string, projectPath?: string) => {
    if (!dbPath) return { success: false, updated: 0, errors: [], error: 'Invalid arguments' }
    try {
      assertDbPathAllowed(dbPath)
      const resolvedProjectPath = projectPath ?? projectPathFromDb(dbPath)

      const rows = await queryLive(
        dbPath,
        `SELECT id, claude_conv_id FROM sessions
         WHERE claude_conv_id IS NOT NULL
           AND (tokens_in = 0 OR tokens_in IS NULL)
         ORDER BY id DESC`,
        []
      ) as Array<{ id: number; claude_conv_id: string }>

      let updated = 0
      const errors: string[] = []

      // Collect all valid updates — run up to 5 parseConvTokens in parallel to reduce latency
      const SYNC_CONCURRENCY = 5
      const updates: Array<{ id: number; counts: Awaited<ReturnType<typeof parseConvTokens>> }> = []
      for (let i = 0; i < rows.length; i += SYNC_CONCURRENCY) {
        const batch = rows.slice(i, i + SYNC_CONCURRENCY)
        await Promise.all(batch.map(async (row) => {
          try {
            const counts = await parseConvTokens(resolvedProjectPath, row.claude_conv_id)
            if (counts.tokensIn > 0 || counts.tokensOut > 0) {
              updates.push({ id: row.id, counts })
            }
          } catch (err) {
            errors.push(`session ${row.id}: ${String(err)}`)
          }
        }))
      }

      // Single writeDb call for all updates — O(1) instead of O(N) full-file rewrites
      if (updates.length > 0) {
        await writeDb(dbPath, (db) => {
          for (const { id, counts } of updates) {
            db.run(
              `UPDATE sessions
               SET tokens_in = ?, tokens_out = ?, tokens_cache_read = ?, tokens_cache_write = ?
               WHERE id = ?`,
              [counts.tokensIn, counts.tokensOut, counts.cacheRead, counts.cacheWrite, id]
            )
          }
        })
        updated = updates.length
      }

      console.log(`[IPC session:syncAllTokens] updated=${updated}/${rows.length}`)
      return { success: true, updated, errors }
    } catch (err) {
      console.error('[IPC session:syncAllTokens]', err)
      return { success: false, updated: 0, errors: [], error: String(err) }
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
      assertDbPathAllowed(dbPath)
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
   * @param updates.maxSessions - Max concurrent sessions: integer >= 1, or -1 for unlimited (T534)
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
      if (!Number.isInteger(updates.maxSessions) || (updates.maxSessions < 1 && updates.maxSessions !== -1)) {
        return { success: false, error: `Invalid maxSessions value: ${updates.maxSessions}. Must be an integer >= 1 or -1 (unlimited).` }
      }
    }
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        const cols: string[] = []
        const vals: (string | number | null)[] = []
        if (updates.name !== undefined) { cols.push('name = ?'); vals.push(updates.name) }
        if (updates.type !== undefined) { cols.push('type = ?'); vals.push(updates.type) }
        if (updates.perimetre !== undefined) { cols.push('perimetre = ?'); vals.push(updates.perimetre || null) }
        if (updates.thinkingMode !== undefined) { cols.push('thinking_mode = ?'); vals.push(updates.thinkingMode || null) }
        if (updates.allowedTools !== undefined) { cols.push('allowed_tools = ?'); vals.push(updates.allowedTools || null) }
        if (updates.systemPrompt !== undefined) { cols.push('system_prompt = ?'); vals.push(updates.systemPrompt || null) }
        if (updates.systemPromptSuffix !== undefined) { cols.push('system_prompt_suffix = ?'); vals.push(updates.systemPromptSuffix || null) }
        if (updates.autoLaunch !== undefined) { cols.push('auto_launch = ?'); vals.push(updates.autoLaunch ? 1 : 0) }
        if (updates.permissionMode !== undefined) { cols.push('permission_mode = ?'); vals.push(updates.permissionMode || null) }
        if (updates.maxSessions !== undefined) { cols.push('max_sessions = ?'); vals.push(updates.maxSessions) }
        if (cols.length === 0) return
        vals.push(agentId)
        db.run(`UPDATE agents SET ${cols.join(', ')} WHERE id = ?`, vals)
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
      assertDbPathAllowed(dbPath)
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
    if (typeof agentId !== 'number' || !Number.isInteger(agentId)) {
      return { success: false, error: 'Invalid agentId' }
    }
    try {
      assertDbPathAllowed(dbPath)
      const result = await writeDb<{ id: number; name: string }>(dbPath, (db) => {
        const stmt = db.prepare('SELECT name, type, perimetre, thinking_mode, system_prompt, system_prompt_suffix, allowed_tools FROM agents WHERE id = ?')
        stmt.bind([agentId])
        if (!stmt.step()) { stmt.free(); throw new Error('Agent not found') }
        const row = stmt.getAsObject()
        stmt.free()
        const { name, type, perimetre, thinking_mode: thinkingMode, system_prompt: systemPrompt, system_prompt_suffix: systemPromptSuffix, allowed_tools: allowedTools } = row as Record<string, string | null>

        // Generate unique name: <name>-copy, then -copy-2, -copy-3, …
        const baseName = `${name}-copy`
        const likeStmt = db.prepare('SELECT name FROM agents WHERE name LIKE ?')
        likeStmt.bind([baseName + '%'])
        const existingNames: string[] = []
        while (likeStmt.step()) { existingNames.push(likeStmt.getAsObject()['name'] as string) }
        likeStmt.free()
        const existing = new Set<string>(existingNames)
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

  /**
   * Fetch all dependency links for a task from task_links.
   * Returns links where the task is source or target, joined with task titles and statuses.
   * @param dbPath - DB path
   * @param taskId - Task ID
   * @returns {{ success: boolean, links: TaskLink[], error?: string }}
   */
  /**
   * T518: Collect and persist token counts for the most recent session of an agent.
   * Called after session close. Finds the latest session with a conv_id but no tokens,
   * parses the JSONL file, and updates sessions.tokens_*.
   *
   * @param dbPath - Registered DB path
   * @param agentName - Agent name to look up
   */
  ipcMain.handle('session:collectTokens', async (_event, dbPath: string, agentName: string) => {
    if (!dbPath || !agentName) return { success: false, error: 'Invalid arguments' }
    try {
      assertDbPathAllowed(dbPath)
      const resolvedProjectPath = projectPathFromDb(dbPath)

      const rows = await queryLive(
        dbPath,
        `SELECT s.id, s.claude_conv_id
         FROM sessions s
         JOIN agents a ON a.id = s.agent_id
         WHERE a.name = ?
           AND s.claude_conv_id IS NOT NULL
           AND (s.tokens_in = 0 OR s.tokens_in IS NULL)
         ORDER BY s.id DESC
         LIMIT 1`,
        [agentName]
      ) as Array<{ id: number; claude_conv_id: string }>

      if (rows.length === 0) return { success: true, tokens: null }

      const { id: sessionId, claude_conv_id: convId } = rows[0]
      const counts = await parseConvTokens(resolvedProjectPath, convId)
      await writeDb(dbPath, (db) => {
        db.run(
          `UPDATE sessions
           SET tokens_in = ?, tokens_out = ?, tokens_cache_read = ?, tokens_cache_write = ?
           WHERE id = ?`,
          [counts.tokensIn, counts.tokensOut, counts.cacheRead, counts.cacheWrite, sessionId]
        )
      })
      console.log(`[IPC session:collectTokens] agent=${agentName} session=${sessionId} in=${counts.tokensIn} out=${counts.tokensOut}`)
      return { success: true, tokens: counts }
    } catch (err) {
      console.error('[IPC session:collectTokens]', err)
      return { success: false, error: String(err) }
    }
  })

  // ── T556: Agent groups CRUD ────────────────────────────────────────────────

  /**
   * List all agent groups with their members.
   * @param dbPath - Registered DB path
   * @returns {{ success: boolean, groups: AgentGroup[], error?: string }}
   */
  ipcMain.handle('agent-groups:list', async (_event, dbPath: string) => {
    try {
      assertDbPathAllowed(dbPath)
      const groups = await queryLive(
        dbPath,
        `SELECT ag.id, ag.name, ag.sort_order, ag.created_at,
                json_group_array(
                  CASE WHEN agm.agent_id IS NOT NULL
                    THEN json_object('agent_id', agm.agent_id, 'sort_order', agm.sort_order)
                    ELSE NULL
                  END
                ) as members_json
         FROM agent_groups ag
         LEFT JOIN agent_group_members agm ON ag.id = agm.group_id
         GROUP BY ag.id
         ORDER BY ag.sort_order`,
        []
      ) as Array<{ id: number; name: string; sort_order: number; created_at: string; members_json: string }>
      const result = groups.map(g => ({
        id: g.id,
        name: g.name,
        sort_order: g.sort_order,
        created_at: g.created_at,
        members: (JSON.parse(g.members_json) as Array<{ agent_id: number; sort_order: number } | null>)
          .filter((m): m is { agent_id: number; sort_order: number } => m !== null)
      }))
      return { success: true, groups: result }
    } catch (err) {
      console.error('[IPC agent-groups:list]', err)
      return { success: false, groups: [], error: String(err) }
    }
  })

  /**
   * Create a new agent group.
   * @param dbPath - Registered DB path
   * @param name - Group name
   * @returns {{ success: boolean, group?: { id, name, sort_order, created_at }, error?: string }}
   */
  ipcMain.handle('agent-groups:create', async (_event, dbPath: string, name: string) => {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { success: false, error: 'Invalid group name' }
    }
    try {
      assertDbPathAllowed(dbPath)
      const group = await writeDb<{ id: number; name: string; sort_order: number; created_at: string }>(dbPath, (db) => {
        db.run(
          `INSERT INTO agent_groups (name, sort_order)
           VALUES (?, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM agent_groups))`,
          [name.trim()]
        )
        const rows = db.exec(`SELECT id, name, sort_order, created_at FROM agent_groups WHERE id = last_insert_rowid()`)
        const row = rows[0].values[0]
        return { id: row[0] as number, name: row[1] as string, sort_order: row[2] as number, created_at: row[3] as string }
      })
      return { success: true, group }
    } catch (err) {
      console.error('[IPC agent-groups:create]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Rename an agent group.
   * @param dbPath - Registered DB path
   * @param groupId - Group ID
   * @param name - New name
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('agent-groups:rename', async (_event, dbPath: string, groupId: number, name: string) => {
    if (typeof groupId !== 'number' || !Number.isInteger(groupId)) {
      return { success: false, error: 'Invalid groupId' }
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { success: false, error: 'Invalid group name' }
    }
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        db.run('UPDATE agent_groups SET name = ? WHERE id = ?', [name.trim(), groupId])
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC agent-groups:rename]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Delete an agent group. Members are explicitly removed first (no FK cascade).
   * @param dbPath - Registered DB path
   * @param groupId - Group ID
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('agent-groups:delete', async (_event, dbPath: string, groupId: number) => {
    if (typeof groupId !== 'number' || !Number.isInteger(groupId)) {
      return { success: false, error: 'Invalid groupId' }
    }
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        // Explicit delete of members — ON DELETE CASCADE requires FK pragma which is off by default
        db.run('DELETE FROM agent_group_members WHERE group_id = ?', [groupId])
        db.run('DELETE FROM agent_groups WHERE id = ?', [groupId])
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC agent-groups:delete]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Assign an agent to a group, or remove it from any group (groupId = null).
   * @param dbPath - Registered DB path
   * @param agentId - Agent ID
   * @param groupId - Target group ID, or null to remove from all groups
   * @param sortOrder - Position within the group (default 0)
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('agent-groups:setMember', async (_event, dbPath: string, agentId: number, groupId: number | null, sortOrder?: number) => {
    if (typeof agentId !== 'number' || !Number.isInteger(agentId)) {
      return { success: false, error: 'Invalid agentId' }
    }
    if (groupId !== null && (typeof groupId !== 'number' || !Number.isInteger(groupId))) {
      return { success: false, error: 'Invalid groupId' }
    }
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        if (groupId === null) {
          db.run('DELETE FROM agent_group_members WHERE agent_id = ?', [agentId])
        } else {
          db.run(
            `INSERT OR REPLACE INTO agent_group_members (group_id, agent_id, sort_order) VALUES (?, ?, ?)`,
            [groupId, agentId, sortOrder ?? 0]
          )
        }
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC agent-groups:setMember]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Reorder groups by updating sort_order for each group ID in the provided array.
   * @param dbPath - Registered DB path
   * @param groupIds - Ordered array of group IDs (index = new sort_order)
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('agent-groups:reorder', async (_event, dbPath: string, groupIds: number[]) => {
    if (!Array.isArray(groupIds) || groupIds.some(id => typeof id !== 'number' || !Number.isInteger(id))) {
      return { success: false, error: 'groupIds must be an array of integers' }
    }
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        for (let i = 0; i < groupIds.length; i++) {
          db.run('UPDATE agent_groups SET sort_order = ? WHERE id = ?', [i, groupIds[i]])
        }
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC agent-groups:reorder]', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('task:getLinks', async (_event, dbPath: string, taskId: number) => {
    if (typeof taskId !== 'number' || !Number.isInteger(taskId)) {
      return { success: false, links: [], error: 'Invalid taskId' }
    }
    assertDbPathAllowed(dbPath)
    try {
      const rows = await queryLive(
        dbPath,
        `SELECT tl.id, tl.type, tl.from_task, tl.to_task,
          tf.titre as from_titre, tf.statut as from_statut,
          tt.titre as to_titre, tt.statut as to_statut
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
