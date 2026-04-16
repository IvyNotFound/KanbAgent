/**
 * IPC handlers — Agent group management
 *
 * Handles CRUD and reordering of agent groups.
 *
 * @module ipc-agent-groups
 */

import { ipcMain } from 'electron'
import { assertDbPathAllowed, queryLive, writeDb } from './db'

// ── Handler registration ─────────────────────────────────────────────────────

/** Register agent group IPC handlers. */
export function registerAgentGroupHandlers(): void {
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
        `SELECT ag.id, ag.name, ag.sort_order, ag.parent_id, ag.created_at,
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
      ) as Array<{ id: number; name: string; sort_order: number; parent_id: number | null; created_at: string; members_json: string }>
      const result = groups.map(g => ({
        id: g.id,
        name: g.name,
        sort_order: g.sort_order,
        parent_id: g.parent_id ?? null,
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
   * @param parentId - Optional parent group ID for nesting (null = root)
   * @returns {{ success: boolean, group?: { id, name, sort_order, parent_id, created_at }, error?: string }}
   */
  ipcMain.handle('agent-groups:create', async (_event, dbPath: string, name: string, parentId?: number | null) => {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { success: false, error: 'Invalid group name' }
    }
    if (parentId !== undefined && parentId !== null && (typeof parentId !== 'number' || !Number.isInteger(parentId))) {
      return { success: false, error: 'Invalid parentId' }
    }
    try {
      assertDbPathAllowed(dbPath)
      const resolvedParentId = parentId ?? null
      const group = await writeDb<{ id: number; name: string; sort_order: number; parent_id: number | null; created_at: string }>(dbPath, (db) => {
        db.run(
          `INSERT INTO agent_groups (name, sort_order, parent_id)
           VALUES (?, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM agent_groups), ?)`,
          [name.trim(), resolvedParentId]
        )
        const rows = db.exec(`SELECT id, name, sort_order, parent_id, created_at FROM agent_groups WHERE id = last_insert_rowid()`)
        const row = rows[0].values[0]
        return { id: row[0] as number, name: row[1] as string, sort_order: row[2] as number, parent_id: row[3] as number | null, created_at: row[4] as string }
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
        const stmt = db.prepare('UPDATE agent_groups SET sort_order = ? WHERE id = ?')
        for (let i = 0; i < groupIds.length; i++) {
          stmt.run([i, groupIds[i]])
        }
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC agent-groups:reorder]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Set the parent of a group (move it in the hierarchy).
   * Rejects if the operation would create a cycle (group cannot be its own ancestor).
   * @param dbPath - Registered DB path
   * @param groupId - Group to reparent
   * @param parentId - New parent group ID, or null to make it a root group
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('agent-groups:setParent', async (_event, dbPath: string, groupId: number, parentId: number | null) => {
    if (typeof groupId !== 'number' || !Number.isInteger(groupId)) {
      return { success: false, error: 'Invalid groupId' }
    }
    if (parentId !== null && (typeof parentId !== 'number' || !Number.isInteger(parentId))) {
      return { success: false, error: 'Invalid parentId' }
    }
    if (parentId === groupId) {
      return { success: false, error: 'A group cannot be its own parent' }
    }
    try {
      assertDbPathAllowed(dbPath)
      const result = await writeDb<{ success: boolean; error?: string }>(dbPath, (db) => {
        // Cycle detection: walk up the ancestor chain of parentId
        if (parentId !== null) {
          let current: number | null = parentId
          const visited = new Set<number>()
          while (current !== null) {
            if (current === groupId) {
              return { success: false, error: 'Cycle detected: groupId is already an ancestor of parentId' }
            }
            if (visited.has(current)) break // safety: break on unexpected cycle in existing data
            visited.add(current)
            const rows = db.exec(`SELECT parent_id FROM agent_groups WHERE id = ${current}`)
            if (rows.length === 0 || rows[0].values.length === 0) break
            current = rows[0].values[0][0] as number | null
          }
        }
        db.run('UPDATE agent_groups SET parent_id = ? WHERE id = ?', [parentId, groupId])
        return { success: true }
      })
      return result
    } catch (err) {
      console.error('[IPC agent-groups:setParent]', err)
      return { success: false, error: String(err) }
    }
  })
}
