import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Agent, Lock, AgentGroup } from '@renderer/types'
import { useProjectStore } from '@renderer/stores/project'
import { normalizeRow } from '@renderer/utils/db'

export const AGENT_CTE_SQL = `
  WITH latest_sessions AS (
    SELECT agent_id, statut, started_at,
           ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY started_at DESC) as rn
    FROM sessions
  ),
  max_logs AS (
    SELECT agent_id, MAX(created_at) as last_log_at
    FROM agent_logs GROUP BY agent_id
  ),
  agent_history AS (
    SELECT a.id,
      CASE WHEN (
        EXISTS (SELECT 1 FROM sessions WHERE agent_id = a.id) OR
        EXISTS (SELECT 1 FROM tasks WHERE agent_assigne_id = a.id) OR
        EXISTS (SELECT 1 FROM task_comments WHERE agent_id = a.id) OR
        EXISTS (SELECT 1 FROM agent_logs WHERE agent_id = a.id)
      ) THEN 1 ELSE 0 END as has_history
    FROM agents a
  )
  SELECT a.*, ls.statut as session_statut, ls.started_at as session_started_at, ml.last_log_at, ah.has_history
  FROM agents a
  LEFT JOIN latest_sessions ls ON ls.agent_id = a.id AND ls.rn = 1
  LEFT JOIN max_logs ml ON ml.agent_id = a.id
  LEFT JOIN agent_history ah ON ah.id = a.id
  WHERE a.type != 'setup' ORDER BY a.name
`

export const LOCKS_SQL = `
  SELECT l.*, a.name as agent_name FROM locks l
  JOIN agents a ON a.id = l.agent_id
  WHERE l.released_at IS NULL
`

/**
 * Builds a tree structure from a flat list of agent groups.
 * Groups without a parent_id (or whose parent is not found) become roots.
 * Each group's `children` array is populated and sorted by sort_order.
 */
export function buildGroupTree(flat: AgentGroup[]): AgentGroup[] {
  const map = new Map<number, AgentGroup>()
  for (const g of flat) {
    map.set(g.id, { ...g, children: [] })
  }
  const roots: AgentGroup[] = []
  for (const g of map.values()) {
    if (g.parent_id === null || g.parent_id === undefined || !map.has(g.parent_id)) {
      roots.push(g)
    } else {
      map.get(g.parent_id)!.children!.push(g)
    }
  }
  const sortRecursive = (arr: AgentGroup[]): void => {
    arr.sort((a, b) => a.sort_order - b.sort_order)
    for (const g of arr) if (g.children?.length) sortRecursive(g.children)
  }
  sortRecursive(roots)
  return roots
}

export const useAgentsStore = defineStore('agents', () => {
  const projectStore = useProjectStore()

  const agents = ref<Agent[]>([])
  const locks = ref<Lock[]>([])
  const agentGroups = ref<AgentGroup[]>([])
  const agentGroupsTree = computed(() => buildGroupTree(agentGroups.value))

  async function query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!projectStore.dbPath) return []
    const result = await window.electronAPI.queryDb(projectStore.dbPath, sql, params)
    if (!Array.isArray(result)) return []
    return result as T[]
  }

  /**
   * Refreshes the agents and active locks lists from the database.
   * Skips silently when the document is hidden (tab not focused).
   */
  async function agentRefresh(): Promise<void> {
    if (!projectStore.dbPath) return
    if (document.visibilityState === 'hidden') return
    try {
      const [rawAgents, rawLocks] = await Promise.all([
        query<Agent>(AGENT_CTE_SQL),
        query<Lock>(LOCKS_SQL),
      ])
      agents.value = rawAgents.map(normalizeRow)
      locks.value = rawLocks.map(normalizeRow)
    } catch {
      // silent: main refresh handles error display
    }
  }

  /**
   * Fetches all agent groups (with their members) and updates `agentGroups`.
   * Silent on error — groups are an optional UI feature.
   */
  async function fetchAgentGroups(): Promise<void> {
    if (!projectStore.dbPath) return
    try {
      const res = await window.electronAPI.agentGroupsList(projectStore.dbPath)
      if (res.success) agentGroups.value = res.groups
    } catch {
      // silent — groups are optional
    }
  }

  /**
   * Creates a new agent group and appends it to `agentGroups`.
   * @param name - Display name for the group.
   * @returns The created AgentGroup (with empty members array), or null on failure.
   */
  async function createAgentGroup(name: string, parentId?: number | null): Promise<AgentGroup | null> {
    if (!projectStore.dbPath) return null
    const res = await window.electronAPI.agentGroupsCreate(projectStore.dbPath, name, parentId)
    if (!res.success || !res.group) return null
    const newGroup: AgentGroup = { ...res.group, members: [] }
    agentGroups.value = [...agentGroups.value, newGroup]
    return newGroup
  }

  /**
   * Renames an agent group locally and in the database.
   * @param groupId - ID of the group to rename.
   * @param name - New display name.
   */
  async function renameAgentGroup(groupId: number, name: string): Promise<void> {
    if (!projectStore.dbPath) return
    await window.electronAPI.agentGroupsRename(projectStore.dbPath, groupId, name)
    agentGroups.value = agentGroups.value.map(g => g.id === groupId ? { ...g, name } : g)
  }

  /**
   * Deletes an agent group and removes it from `agentGroups`.
   * @param groupId - ID of the group to delete.
   */
  async function deleteAgentGroup(groupId: number): Promise<void> {
    if (!projectStore.dbPath) return
    await window.electronAPI.agentGroupsDelete(projectStore.dbPath, groupId)
    agentGroups.value = agentGroups.value.filter(g => g.id !== groupId)
  }

  /**
   * Assigns or removes an agent from a group, updating sort order.
   * @param agentId - ID of the agent to move.
   * @param groupId - Target group ID, or null to remove from any group.
   * @param sortOrder - Optional position within the group.
   */
  async function setAgentGroup(agentId: number, groupId: number | null, sortOrder?: number): Promise<void> {
    if (!projectStore.dbPath) return
    await window.electronAPI.agentGroupsSetMember(projectStore.dbPath, agentId, groupId, sortOrder)
    agentGroups.value = agentGroups.value.map(g => {
      const filtered = g.members.filter(m => m.agent_id !== agentId)
      if (g.id === groupId) {
        return { ...g, members: [...filtered, { agent_id: agentId, sort_order: sortOrder ?? g.members.length }] }
      }
      return filtered.length !== g.members.length ? { ...g, members: filtered } : g
    })
  }

  /**
   * Changes the parent of a group (hierarchy). Refetches groups after success.
   */
  async function setGroupParent(groupId: number, parentId: number | null): Promise<void> {
    if (!projectStore.dbPath) return
    await window.electronAPI.agentGroupsSetParent(projectStore.dbPath, groupId, parentId)
    await fetchAgentGroups()
  }

  return {
    agents, locks, agentGroups, agentGroupsTree,
    agentRefresh, fetchAgentGroups,
    createAgentGroup, renameAgentGroup, deleteAgentGroup, setAgentGroup, setGroupParent,
    // Expose SQL constants and query helper for use by useTasksStore
    AGENT_CTE_SQL, LOCKS_SQL, query,
  }
})
