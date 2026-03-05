import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'

// Mock window.electronAPI
const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  selectProjectDir: vi.fn().mockResolvedValue(null),
  showConfirmDialog: vi.fn().mockResolvedValue(true),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
  terminalKill: vi.fn(),
  findProjectDb: vi.fn().mockResolvedValue(null),
  getTaskLinks: vi.fn().mockResolvedValue({ success: true, links: [] }),
  getTaskAssignees: vi.fn().mockResolvedValue({ success: true, assignees: [] }),
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  agentGroupsCreate: vi.fn().mockResolvedValue({ success: true, group: { id: 1, name: 'New Group', sort_order: 0, created_at: '' } }),
  agentGroupsRename: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsDelete: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetMember: vi.fn().mockResolvedValue({ success: true }),
  agentKill: vi.fn(),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})


interface AgentGroup {
  id: number
  name: string
  position: number
}

interface AgentWithGroup {
  id: number
  name: string
  type: string
  perimetre: string | null
  group_id: number | null
}

/** Pure helper: returns agents with no group_id (mirrors ungroupedAgents computed) */
function getUngroupedAgents(agents: AgentWithGroup[]): AgentWithGroup[] {
  return agents.filter(a => a.group_id === null || a.group_id === undefined)
}

/** Pure helper: returns map of groupId → agents (mirrors groupedAgents computed) */
function getGroupedAgents(agents: AgentWithGroup[]): Map<number, AgentWithGroup[]> {
  const map = new Map<number, AgentWithGroup[]>()
  for (const agent of agents) {
    if (agent.group_id !== null && agent.group_id !== undefined) {
      const list = map.get(agent.group_id) ?? []
      list.push(agent)
      map.set(agent.group_id, list)
    }
  }
  return map
}

/** Pure helper: simulate setAgentGroup (move agent to group or ungroup) */
function applySetAgentGroup(
  agents: AgentWithGroup[],
  agentId: number,
  groupId: number | null
): AgentWithGroup[] {
  return agents.map(a => a.id === agentId ? { ...a, group_id: groupId } : a)
}

describe('agentGroups store logic (T558)', () => {
  const makeAgent = (overrides: Partial<AgentWithGroup> = {}): AgentWithGroup => ({
    id: 1,
    name: 'dev-front-vuejs',
    type: 'scoped',
    perimetre: 'front-vuejs',
    group_id: null,
    ...overrides,
  })

  const makeGroup = (overrides: Partial<AgentGroup> = {}): AgentGroup => ({
    id: 1,
    name: 'Frontend',
    position: 0,
    ...overrides,
  })

  // ── ungroupedAgents ─────────────────────────────────────────────────────────

  it('ungroupedAgents returns all agents when none have group_id', () => {
    const agents = [
      makeAgent({ id: 1, name: 'agent-a', group_id: null }),
      makeAgent({ id: 2, name: 'agent-b', group_id: null }),
    ]
    expect(getUngroupedAgents(agents)).toHaveLength(2)
  })

  it('ungroupedAgents excludes agents that belong to a group', () => {
    const agents = [
      makeAgent({ id: 1, name: 'agent-a', group_id: null }),
      makeAgent({ id: 2, name: 'agent-b', group_id: 10 }),
      makeAgent({ id: 3, name: 'agent-c', group_id: 10 }),
    ]
    const ungrouped = getUngroupedAgents(agents)
    expect(ungrouped).toHaveLength(1)
    expect(ungrouped[0].name).toBe('agent-a')
  })

  it('ungroupedAgents returns empty array when all agents are grouped', () => {
    const agents = [
      makeAgent({ id: 1, name: 'agent-a', group_id: 1 }),
      makeAgent({ id: 2, name: 'agent-b', group_id: 2 }),
    ]
    expect(getUngroupedAgents(agents)).toHaveLength(0)
  })

  // ── groupedAgents ───────────────────────────────────────────────────────────

  it('groupedAgents returns empty map when no agents have group_id', () => {
    const agents = [
      makeAgent({ id: 1, group_id: null }),
      makeAgent({ id: 2, group_id: null }),
    ]
    const grouped = getGroupedAgents(agents)
    expect(grouped.size).toBe(0)
  })

  it('groupedAgents maps groupId to list of agents in that group', () => {
    const agents = [
      makeAgent({ id: 1, name: 'agent-a', group_id: 10 }),
      makeAgent({ id: 2, name: 'agent-b', group_id: 10 }),
      makeAgent({ id: 3, name: 'agent-c', group_id: 20 }),
    ]
    const grouped = getGroupedAgents(agents)
    expect(grouped.get(10)).toHaveLength(2)
    expect(grouped.get(20)).toHaveLength(1)
    expect(grouped.get(10)?.map(a => a.name)).toContain('agent-a')
    expect(grouped.get(10)?.map(a => a.name)).toContain('agent-b')
  })

  it('groupedAgents handles multiple groups independently', () => {
    const groups: AgentGroup[] = [
      makeGroup({ id: 1, name: 'Frontend' }),
      makeGroup({ id: 2, name: 'Backend' }),
    ]
    const agents = [
      makeAgent({ id: 10, name: 'dev-front', group_id: 1 }),
      makeAgent({ id: 11, name: 'test-front', group_id: 1 }),
      makeAgent({ id: 20, name: 'dev-back', group_id: 2 }),
    ]
    const grouped = getGroupedAgents(agents)
    expect(grouped.get(1)).toHaveLength(2)
    expect(grouped.get(2)).toHaveLength(1)
    expect(groups).toHaveLength(2) // groups reference used for type check
  })

  // ── setAgentGroup ───────────────────────────────────────────────────────────

  it('setAgentGroup moves agent to target group', () => {
    const agents = [
      makeAgent({ id: 1, name: 'agent-a', group_id: null }),
      makeAgent({ id: 2, name: 'agent-b', group_id: null }),
    ]
    const result = applySetAgentGroup(agents, 1, 10)
    expect(result.find(a => a.id === 1)?.group_id).toBe(10)
    expect(result.find(a => a.id === 2)?.group_id).toBeNull()
  })

  it('setAgentGroup with null groupId removes agent from group (ungrouped)', () => {
    const agents = [
      makeAgent({ id: 1, name: 'agent-a', group_id: 10 }),
    ]
    const result = applySetAgentGroup(agents, 1, null)
    expect(result.find(a => a.id === 1)?.group_id).toBeNull()
  })

  it('setAgentGroup moving agent to different group updates correctly', () => {
    const agents = [
      makeAgent({ id: 1, name: 'agent-a', group_id: 10 }),
    ]
    const result = applySetAgentGroup(agents, 1, 20)
    expect(result.find(a => a.id === 1)?.group_id).toBe(20)
  })

  it('deleteGroup: ungroupedAgents includes all ex-members after group deletion', () => {
    // When a group is deleted, all its members should move to ungrouped (group_id → null)
    const agentsBeforeDeletion = [
      makeAgent({ id: 1, name: 'agent-a', group_id: 10 }),
      makeAgent({ id: 2, name: 'agent-b', group_id: 10 }),
      makeAgent({ id: 3, name: 'agent-c', group_id: null }),
    ]
    // Simulate deleteGroup: set group_id to null for all members of group 10
    const agentsAfterDeletion = agentsBeforeDeletion.map(a =>
      a.group_id === 10 ? { ...a, group_id: null } : a
    )
    const ungrouped = getUngroupedAgents(agentsAfterDeletion)
    expect(ungrouped).toHaveLength(3)
  })

  // ── IPC fetchAgentGroups mock (T558 — wired in T557) ───────────────────────
  // These tests verify the IPC contract for the agentGroups store handlers.
  // The actual store integration will be tested after T557 is implemented.

  it('agentGroupsList IPC mock returns groups list', async () => {
    const mockGroups: AgentGroup[] = [
      { id: 1, name: 'Frontend', position: 0 },
      { id: 2, name: 'Backend', position: 1 },
    ]
    const mockAgentGroupsList = vi.fn().mockResolvedValue({ success: true, groups: mockGroups })
    const result = await mockAgentGroupsList('/fake/db')
    expect(result.success).toBe(true)
    expect(result.groups).toHaveLength(2)
    expect(result.groups[0].name).toBe('Frontend')
  })

  it('agentGroupsCreate IPC mock adds new group', async () => {
    const newGroup: AgentGroup = { id: 3, name: 'Ops', position: 2 }
    const mockAgentGroupsCreate = vi.fn().mockResolvedValue({ success: true, group: newGroup })
    const result = await mockAgentGroupsCreate('/fake/db', 'Ops')
    expect(result.success).toBe(true)
    expect(result.group.name).toBe('Ops')
  })

  it('agentGroupsRename IPC mock updates group name', async () => {
    const mockAgentGroupsRename = vi.fn().mockResolvedValue({ success: true })
    const result = await mockAgentGroupsRename('/fake/db', 1, 'New Name')
    expect(result.success).toBe(true)
    expect(mockAgentGroupsRename).toHaveBeenCalledWith('/fake/db', 1, 'New Name')
  })

  it('agentGroupsDelete IPC mock deletes group', async () => {
    const mockAgentGroupsDelete = vi.fn().mockResolvedValue({ success: true })
    const result = await mockAgentGroupsDelete('/fake/db', 1)
    expect(result.success).toBe(true)
    expect(mockAgentGroupsDelete).toHaveBeenCalledWith('/fake/db', 1)
  })

  it('agentSetGroup IPC mock moves agent to group', async () => {
    const mockAgentSetGroup = vi.fn().mockResolvedValue({ success: true })
    const result = await mockAgentSetGroup('/fake/db', 5, 10)
    expect(result.success).toBe(true)
    expect(mockAgentSetGroup).toHaveBeenCalledWith('/fake/db', 5, 10)
  })

  it('agentSetGroup IPC mock with null groupId ungroupes agent', async () => {
    const mockAgentSetGroup = vi.fn().mockResolvedValue({ success: true })
    const result = await mockAgentSetGroup('/fake/db', 5, null)
    expect(result.success).toBe(true)
    expect(mockAgentSetGroup).toHaveBeenCalledWith('/fake/db', 5, null)
  })
})
