import { computed, ref, watch } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useAgentsStore } from '@renderer/stores/agents'
import type { Agent, AgentGroup } from '@renderer/types'

export interface GroupTreeNode {
  id: string
  name: string
  nodeType: 'group'
  group: AgentGroup
  children: (GroupTreeNode | AgentTreeNode)[]
}

export interface AgentTreeNode {
  id: string
  name: string
  nodeType: 'agent'
  agent: Agent
}

export interface FlatGroupNode {
  id: string
  type: 'group'
  depth: number
  group: AgentGroup
}

export interface FlatAgentNode {
  id: string
  type: 'agent'
  depth: number
  agent: Agent
}

export type FlatNode = FlatGroupNode | FlatAgentNode

/**
 * Builds the flat tree list used by SidebarAgentSection to render grouped agents.
 * Handles treeItems construction, localStorage-synced collapse state, and flatNodes derivation.
 */
export function useSidebarTree() {
  const store = useTasksStore()
  const agentsStore = useAgentsStore()

  const treeItems = computed<GroupTreeNode[]>(() => {
    const agents = store.agents

    function convertGroup(group: AgentGroup): GroupTreeNode {
      const agentNodes: AgentTreeNode[] = [...(group.members ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(m => agents.find(a => a.id === m.agent_id))
        .filter((a): a is Agent => !!a)
        .map(agent => ({
          id: `a-${agent.id}`,
          name: agent.name,
          nodeType: 'agent' as const,
          agent,
        }))

      const childGroups: GroupTreeNode[] = (group.children ?? []).map(convertGroup)

      return {
        id: `g-${group.id}`,
        name: group.name,
        nodeType: 'group' as const,
        group,
        children: [...childGroups, ...agentNodes],
      }
    }

    return agentsStore.agentGroupsTree.map(convertGroup)
  })

  // Key `sidebar-group-{id}`: 'true' = collapsed, 'false' / absent = expanded (inverted semantics —
  // do not change, would break existing user state)
  const openedSet = ref(new Set<string>())
  const initializedGroupIds = new Set<number>()

  watch(treeItems, (items) => {
    let changed = false
    const s = new Set(openedSet.value)

    function collect(nodes: (GroupTreeNode | AgentTreeNode)[]): void {
      for (const n of nodes) {
        if (n.nodeType === 'group') {
          if (!initializedGroupIds.has(n.group.id)) {
            initializedGroupIds.add(n.group.id)
            if (localStorage.getItem(`sidebar-group-${n.group.id}`) !== 'true') {
              s.add(n.id)
              changed = true
            }
          }
          collect(n.children)
        }
      }
    }
    collect(items)
    if (changed) openedSet.value = s
  }, { immediate: true })

  function toggleGroup(treeId: string, numericId: number): void {
    const s = new Set(openedSet.value)
    if (s.has(treeId)) {
      s.delete(treeId)
      localStorage.setItem(`sidebar-group-${numericId}`, 'true')
    } else {
      s.add(treeId)
      localStorage.setItem(`sidebar-group-${numericId}`, 'false')
    }
    openedSet.value = s
  }

  const flatNodes = computed<FlatNode[]>(() => {
    const result: FlatNode[] = []

    function flatten(nodes: (GroupTreeNode | AgentTreeNode)[], depth: number): void {
      for (const node of nodes) {
        if (node.nodeType === 'group') {
          result.push({ id: node.id, type: 'group', depth, group: node.group })
          if (openedSet.value.has(node.id)) {
            flatten(node.children, depth + 1)
          }
        } else {
          result.push({ id: node.id, type: 'agent', depth, agent: node.agent })
        }
      }
    }

    flatten(treeItems.value, 0)
    return result
  })

  return { treeItems, openedSet, toggleGroup, flatNodes }
}
