/**
 * IPC handlers — Agent CRUD operations
 *
 * Handles agent creation, deletion, renaming, and field updates.
 *
 * @module ipc-agent-crud
 */

import { ipcMain } from 'electron'
import { readFile, writeFile, rename } from 'fs/promises'
import { join } from 'path'
import { assertDbPathAllowed, assertProjectPathAllowed, queryLive, writeDb } from './db'
import { insertAgentIntoClaudeMd } from './claude-md'
import {
  PositiveIdSchema,
  AgentDisplayNameSchema,
  SystemPromptSchema,
  CreateAgentDataSchema,
  UpdateAgentDataSchema,
} from '../shared/ipc-schemas'

// ── Constants ────────────────────────────────────────────────────────────────

export const STANDARD_AGENT_SUFFIX = [
  '---',
  'AGENT PROTOCOL REMINDER (mandatory — do not override):',
  '- On startup: read input session (sessions.summary) + open tasks from project.db',
  '- Before modifying a file: check locks, then INSERT OR REPLACE INTO locks',
  "- When taking a task: UPDATE tasks SET status='in_progress'",
  "- When finishing a task: UPDATE tasks SET status='done' + INSERT INTO task_comments (task_id, agent_id, content) VALUES (?, ?, '<files changed · what was done · what remains>')",
  "- When ending session: release all locks + UPDATE sessions SET status='completed', summary='Done:... Pending:... Next:...' (this IS the input session for next startup)",
  '- Never commit directly to main in multi-user mode',
  '- Never edit project.db manually',
].join('\n')

// ── Handler registration ─────────────────────────────────────────────────────

/** Register agent CRUD IPC handlers. */
export function registerAgentCrudHandlers(): void {
  /**
   * Rename an agent in the database.
   * @param dbPath - Registered DB path
   * @param agentId - Agent ID to rename
   * @param newName - New agent name
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('rename-agent', async (_event, dbPath: string, agentId: number, newName: string) => {
    if (!PositiveIdSchema.safeParse(agentId).success) {
      return { success: false, error: 'Invalid agentId: must be a positive integer' }
    }
    if (!AgentDisplayNameSchema.safeParse(newName).success) {
      return { success: false, error: 'Invalid newName: must be a non-empty string (max 200 chars)' }
    }
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
   * Update the system_prompt field for an agent.
   * @param dbPath - Registered DB path
   * @param agentId - Agent ID
   * @param systemPrompt - New system prompt content
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('update-agent-system-prompt', async (_event, dbPath: string, agentId: number, systemPrompt: string) => {
    if (!PositiveIdSchema.safeParse(agentId).success) {
      return { success: false, error: 'Invalid agentId: must be a positive integer' }
    }
    if (!SystemPromptSchema.safeParse(systemPrompt).success) {
      return { success: false, error: 'Invalid systemPrompt: must be a string (max 100 000 chars)' }
    }
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
        'SELECT system_prompt, system_prompt_suffix, thinking_mode, permission_mode, worktree_enabled, preferred_model, preferred_cli FROM agents WHERE id = ?',
        [agentId]
      )
      if (rows.length === 0) {
        return { success: false, error: 'Agent not found', systemPrompt: null, systemPromptSuffix: null, thinkingMode: null, permissionMode: null, worktreeEnabled: null, preferredModel: null, preferredCli: null }
      }
      const row = rows[0] as { system_prompt: string | null; system_prompt_suffix: string | null; thinking_mode: string | null; permission_mode: string | null; worktree_enabled: number | null; preferred_model: string | null; preferred_cli: string | null }
      return {
        success: true,
        systemPrompt: row.system_prompt,
        systemPromptSuffix: row.system_prompt_suffix,
        thinkingMode: row.thinking_mode,
        permissionMode: row.permission_mode,
        worktreeEnabled: row.worktree_enabled,
        preferredModel: row.preferred_model,
        preferredCli: row.preferred_cli,
      }
    } catch (err) {
      console.error('[IPC get-agent-system-prompt]', err)
      return { success: false, error: String(err), systemPrompt: null, systemPromptSuffix: null, thinkingMode: null, permissionMode: null, worktreeEnabled: null, preferredModel: null, preferredCli: null }
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
    scope?: string | null
    perimetre?: string | null
    thinkingMode?: string | null
    allowedTools?: string | null
    systemPrompt?: string | null
    systemPromptSuffix?: string | null
    autoLaunch?: boolean
    permissionMode?: 'default' | 'auto' | null
    maxSessions?: number
    worktreeEnabled?: boolean | null
    preferredModel?: string | null
    preferredCli?: string | null
  }) => {
    if (!PositiveIdSchema.safeParse(agentId).success) {
      return { success: false, error: 'Invalid agentId: must be a positive integer' }
    }
    const updatesResult = UpdateAgentDataSchema.safeParse(updates)
    if (!updatesResult.success) {
      const issue = updatesResult.error.issues[0]
      if (issue && issue.path[0] === 'maxSessions') {
        return { success: false, error: `Invalid maxSessions value: ${updates.maxSessions}. Must be an integer >= 1 or -1 (unlimited).` }
      }
      return { success: false, error: 'Invalid updates: ' + updatesResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ') }
    }
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        const cols: string[] = []
        const vals: (string | number | null)[] = []
        if (updates.name !== undefined) { cols.push('name = ?'); vals.push(updates.name) }
        if (updates.type !== undefined) { cols.push('type = ?'); vals.push(updates.type) }
        if ((updates.scope ?? updates.perimetre) !== undefined) { cols.push('scope = ?'); vals.push(updates.scope ?? updates.perimetre ?? null) }
        if (updates.thinkingMode !== undefined) { cols.push('thinking_mode = ?'); vals.push(updates.thinkingMode || null) }
        if (updates.allowedTools !== undefined) { cols.push('allowed_tools = ?'); vals.push(updates.allowedTools || null) }
        if (updates.systemPrompt !== undefined) { cols.push('system_prompt = ?'); vals.push(updates.systemPrompt || null) }
        if (updates.systemPromptSuffix !== undefined) { cols.push('system_prompt_suffix = ?'); vals.push(updates.systemPromptSuffix || null) }
        if (updates.autoLaunch !== undefined) { cols.push('auto_launch = ?'); vals.push(updates.autoLaunch ? 1 : 0) }
        if (updates.permissionMode !== undefined) { cols.push('permission_mode = ?'); vals.push(updates.permissionMode || null) }
        if (updates.maxSessions !== undefined) { cols.push('max_sessions = ?'); vals.push(updates.maxSessions) }
        if (updates.worktreeEnabled !== undefined) { cols.push('worktree_enabled = ?'); vals.push(updates.worktreeEnabled === null ? null : updates.worktreeEnabled ? 1 : 0) }
        if (updates.preferredModel !== undefined) { cols.push('preferred_model = ?'); vals.push(updates.preferredModel || null) }
        if (updates.preferredCli !== undefined) { cols.push('preferred_cli = ?'); vals.push(updates.preferredCli || null) }
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
          (SELECT COUNT(*) FROM tasks WHERE agent_assigned_id = ?) +
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
    data: { name: string; type: string; perimetre?: string | null; scope?: string | null; thinkingMode: string | null; systemPrompt: string | null; description: string }
  ) => {
    const dataResult = CreateAgentDataSchema.safeParse(data)
    if (!dataResult.success) {
      return { success: false, error: 'Invalid args: ' + dataResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ') }
    }
    try {
      assertDbPathAllowed(dbPath)
      assertProjectPathAllowed(projectPath)

      const agentId = await writeDb<number>(dbPath, (db) => {
        db.run(
          'INSERT INTO agents (name, type, scope, thinking_mode, system_prompt, system_prompt_suffix, preferred_model) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [data.name, data.type, data.scope ?? data.perimetre ?? null, data.thinkingMode ?? null, data.systemPrompt ?? null, STANDARD_AGENT_SUFFIX, data.preferredModel ?? null]
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
        const stmt = db.prepare('SELECT name, type, scope, thinking_mode, system_prompt, system_prompt_suffix, allowed_tools FROM agents WHERE id = ?')
        stmt.bind([agentId])
        if (!stmt.step()) { stmt.free(); throw new Error('Agent not found') }
        const row = stmt.getAsObject()
        stmt.free()
        const { name, type, scope, thinking_mode: thinkingMode, system_prompt: systemPrompt, system_prompt_suffix: systemPromptSuffix, allowed_tools: allowedTools } = row as Record<string, string | null>

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
          'INSERT INTO agents (name, type, scope, thinking_mode, system_prompt, system_prompt_suffix, allowed_tools, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
          [newName, type, scope, thinkingMode, systemPrompt, systemPromptSuffix, allowedTools]
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
