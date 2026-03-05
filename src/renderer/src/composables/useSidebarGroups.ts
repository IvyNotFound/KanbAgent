/**
 * Composable: agent group management (rename, create, delete, subgroup) in the Sidebar.
 *
 * Provides inline rename state, create-group flow (top-level or sub-group) and
 * delete confirmation (with a guard when the group still has members).
 * All mutations are delegated to `useTasksStore`.
 */
import { ref, nextTick } from 'vue'
import type { InjectionKey } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'

export function useSidebarGroups() {
  const store = useTasksStore()

  const confirmDeleteGroup = ref<{ groupId: number } | null>(null)

  // ── Inline rename ───────────────────────────────────────────────────────────
  const renamingGroupId = ref<number | null>(null)
  const renameGroupName = ref('')
  const renameGroupInputEl = ref<HTMLInputElement | null>(null)

  async function startRename(group: { id: number; name: string }): Promise<void> {
    renamingGroupId.value = group.id
    renameGroupName.value = group.name
    await nextTick()
    renameGroupInputEl.value?.focus()
  }

  async function confirmRename(groupId: number): Promise<void> {
    const name = renameGroupName.value.trim()
    if (name) await store.renameAgentGroup(groupId, name)
    renamingGroupId.value = null
  }

  function cancelRename(): void {
    renamingGroupId.value = null
  }

  // ── Create top-level group ──────────────────────────────────────────────────
  const creatingGroup = ref(false)
  const newGroupName = ref('')
  const createGroupInputEl = ref<HTMLInputElement | null>(null)

  async function startCreateGroup(): Promise<void> {
    creatingGroup.value = true
    newGroupName.value = ''
    await nextTick()
    createGroupInputEl.value?.focus()
  }

  async function confirmCreateGroup(): Promise<void> {
    const name = newGroupName.value.trim()
    if (name) await store.createAgentGroup(name)
    creatingGroup.value = false
  }

  function cancelCreateGroup(): void {
    creatingGroup.value = false
  }

  // ── Create sub-group ────────────────────────────────────────────────────────
  /** ID of the parent group for which a sub-group is being created. */
  const creatingSubgroupForId = ref<number | null>(null)
  const newSubgroupName = ref('')
  const createSubgroupInputEl = ref<HTMLInputElement | null>(null)

  async function startCreateSubgroup(parentId: number): Promise<void> {
    creatingSubgroupForId.value = parentId
    newSubgroupName.value = ''
    await nextTick()
    createSubgroupInputEl.value?.focus()
  }

  async function confirmCreateSubgroup(): Promise<void> {
    const name = newSubgroupName.value.trim()
    if (name && creatingSubgroupForId.value !== null) {
      await store.createAgentGroup(name, creatingSubgroupForId.value)
    }
    creatingSubgroupForId.value = null
  }

  function cancelCreateSubgroup(): void {
    creatingSubgroupForId.value = null
  }

  // ── Delete group ────────────────────────────────────────────────────────────
  async function handleDeleteGroup(groupId: number): Promise<void> {
    const members = store.agentGroups.find(g => g.id === groupId)?.members ?? []
    if (members.length > 0) {
      confirmDeleteGroup.value = { groupId }
      return
    }
    await store.deleteAgentGroup(groupId)
  }

  async function onConfirmDeleteGroup(): Promise<void> {
    if (!confirmDeleteGroup.value) return
    await store.deleteAgentGroup(confirmDeleteGroup.value.groupId)
    confirmDeleteGroup.value = null
  }

  return {
    confirmDeleteGroup,
    renamingGroupId,
    renameGroupName,
    renameGroupInputEl,
    startRename,
    confirmRename,
    cancelRename,
    creatingGroup,
    newGroupName,
    createGroupInputEl,
    startCreateGroup,
    confirmCreateGroup,
    cancelCreateGroup,
    creatingSubgroupForId,
    newSubgroupName,
    createSubgroupInputEl,
    startCreateSubgroup,
    confirmCreateSubgroup,
    cancelCreateSubgroup,
    handleDeleteGroup,
    onConfirmDeleteGroup,
  }
}

export type SidebarGroupsState = ReturnType<typeof useSidebarGroups>
export const sidebarGroupsKey: InjectionKey<SidebarGroupsState> = Symbol('sidebarGroups')
