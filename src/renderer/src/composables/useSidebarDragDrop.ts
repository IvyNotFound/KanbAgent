/**
 * Composable: HTML5 drag-and-drop for moving agents between sidebar groups,
 * and for reparenting groups (drag a group onto another group).
 *
 * Drag sources:
 *  - Agent card → dataTransfer key "agent-id"
 *  - Group header → dataTransfer key "group-id"
 *
 * Drop targets:
 *  - Group body → agent drop (moves agent into group)
 *  - Group header → group drop (changes parent of dragged group)
 *  - Ungrouped section → agent drop (removes from group)
 */
import { ref } from 'vue'
import type { InjectionKey } from 'vue'
import type { Agent, AgentGroup } from '@renderer/types'
import { useTasksStore } from '@renderer/stores/tasks'

export function useSidebarDragDrop() {
  const store = useTasksStore()

  const dragAgentId = ref<number | null>(null)
  const dragGroupId = ref<number | null>(null)
  const dragOverGroupId = ref<number | null | '__ungrouped__'>(null)

  function onAgentDragStart(event: DragEvent, agent: Agent): void {
    dragAgentId.value = agent.id
    dragGroupId.value = null
    event.dataTransfer!.setData('agent-id', String(agent.id))
    event.dataTransfer!.effectAllowed = 'move'
  }

  function onGroupDragStart(event: DragEvent, group: AgentGroup): void {
    event.stopPropagation()
    dragGroupId.value = group.id
    dragAgentId.value = null
    event.dataTransfer!.setData('group-id', String(group.id))
    event.dataTransfer!.effectAllowed = 'move'
  }

  function onGroupDragOver(event: DragEvent, groupId: number | null): void {
    event.preventDefault()
    dragOverGroupId.value = groupId === null ? '__ungrouped__' : groupId
    event.dataTransfer!.dropEffect = 'move'
  }

  function onGroupDragLeave(event: DragEvent): void {
    const target = event.currentTarget as HTMLElement
    // relatedTarget is null when dragging outside the window — contains(null) returns false → correct reset
    if (target.contains(event.relatedTarget as Node)) return
    dragOverGroupId.value = null
  }

  async function onGroupDrop(event: DragEvent, targetGroupId: number | null): Promise<void> {
    event.preventDefault()
    dragOverGroupId.value = null

    const rawGroupId = event.dataTransfer!.getData('group-id')
    if (rawGroupId) {
      // A group was dropped onto another group → reparent
      const groupId = Number(rawGroupId)
      dragGroupId.value = null
      if (!groupId || groupId === targetGroupId) return
      await store.setGroupParent(groupId, targetGroupId)
      return
    }

    const agentId = Number(event.dataTransfer!.getData('agent-id'))
    dragAgentId.value = null
    if (!agentId) return
    await store.setAgentGroup(agentId, targetGroupId)
  }

  return {
    dragAgentId,
    dragGroupId,
    dragOverGroupId,
    onAgentDragStart,
    onGroupDragStart,
    onGroupDragOver,
    onGroupDragLeave,
    onGroupDrop,
  }
}

export type SidebarDragDropState = ReturnType<typeof useSidebarDragDrop>
export const sidebarDragDropKey: InjectionKey<SidebarDragDropState> = Symbol('sidebarDragDrop')
