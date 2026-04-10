/**
 * Mutation-focused tests for useSidebarGroups (T1286)
 *
 * Targets surviving mutants from Stryker report:
 * - NoCoverage branches in useSidebarGroups: subgroup create/cancel, confirmRename empty trim
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { installMockElectronAPI } from './__helpers__/sidebar-mutation.helpers'

installMockElectronAPI()

// ---- useSidebarGroups mutation coverage ----
describe('useSidebarGroups mutation coverage (T1286)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('confirmRename() with whitespace-only name does NOT call store.renameAgentGroup', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useAgentsStore()
    const spy = vi.spyOn(store, 'renameAgentGroup').mockResolvedValue(undefined)

    const { renamingGroupId, renameGroupName, confirmRename } = useSidebarGroups()
    renamingGroupId.value = 5
    renameGroupName.value = '   ' // whitespace only -- trim() yields ''

    await confirmRename(5)

    expect(spy).not.toHaveBeenCalled()
    expect(renamingGroupId.value).toBeNull()
  })

  it('startCreateGroup() sets creatingGroup=true and clears newGroupName', async () => {
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')
    const { creatingGroup, newGroupName, startCreateGroup } = useSidebarGroups()

    expect(creatingGroup.value).toBe(false)

    newGroupName.value = 'OldName'
    await startCreateGroup()

    expect(creatingGroup.value).toBe(true)
    expect(newGroupName.value).toBe('')
  })

  it('cancelCreateGroup() resets creatingGroup to false', async () => {
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')
    const { creatingGroup, startCreateGroup, cancelCreateGroup } = useSidebarGroups()

    await startCreateGroup()
    expect(creatingGroup.value).toBe(true)

    cancelCreateGroup()
    expect(creatingGroup.value).toBe(false)
  })

  it('confirmCreateGroup() calls store.createAgentGroup and resets creatingGroup', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useAgentsStore()
    const spy = vi.spyOn(store, 'createAgentGroup').mockResolvedValue(null)

    const { creatingGroup, newGroupName, confirmCreateGroup } = useSidebarGroups()
    creatingGroup.value = true
    newGroupName.value = 'NewTopLevel'

    await confirmCreateGroup()

    expect(spy).toHaveBeenCalledWith('NewTopLevel')
    expect(creatingGroup.value).toBe(false)
  })

  it('startCreateSubgroup() sets creatingSubgroupForId and clears newSubgroupName', async () => {
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')
    const { creatingSubgroupForId, newSubgroupName, startCreateSubgroup } = useSidebarGroups()

    expect(creatingSubgroupForId.value).toBeNull()

    newSubgroupName.value = 'OldSub'
    await startCreateSubgroup(99)

    expect(creatingSubgroupForId.value).toBe(99)
    expect(newSubgroupName.value).toBe('')
  })

  it('cancelCreateSubgroup() resets creatingSubgroupForId to null', async () => {
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')
    const { creatingSubgroupForId, startCreateSubgroup, cancelCreateSubgroup } = useSidebarGroups()

    await startCreateSubgroup(10)
    expect(creatingSubgroupForId.value).toBe(10)

    cancelCreateSubgroup()
    expect(creatingSubgroupForId.value).toBeNull()
  })

  it('confirmCreateSubgroup() with valid name calls store.createAgentGroup with parentId', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useAgentsStore()
    const spy = vi.spyOn(store, 'createAgentGroup').mockResolvedValue(null)

    const { creatingSubgroupForId, newSubgroupName, confirmCreateSubgroup } = useSidebarGroups()
    creatingSubgroupForId.value = 7
    newSubgroupName.value = 'SubGroupName'

    await confirmCreateSubgroup()

    expect(spy).toHaveBeenCalledWith('SubGroupName', 7)
    expect(creatingSubgroupForId.value).toBeNull()
  })

  it('confirmCreateSubgroup() with empty name does NOT call store.createAgentGroup', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useAgentsStore()
    const spy = vi.spyOn(store, 'createAgentGroup').mockResolvedValue(null)

    const { creatingSubgroupForId, newSubgroupName, confirmCreateSubgroup } = useSidebarGroups()
    creatingSubgroupForId.value = 7
    newSubgroupName.value = '' // empty

    await confirmCreateSubgroup()

    expect(spy).not.toHaveBeenCalled()
    expect(creatingSubgroupForId.value).toBeNull()
  })

  it('confirmCreateSubgroup() with null parentId does NOT call store.createAgentGroup', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useAgentsStore()
    const spy = vi.spyOn(store, 'createAgentGroup').mockResolvedValue(null)

    const { creatingSubgroupForId, newSubgroupName, confirmCreateSubgroup } = useSidebarGroups()
    creatingSubgroupForId.value = null // no parent selected
    newSubgroupName.value = 'SubGroupName'

    await confirmCreateSubgroup()

    expect(spy).not.toHaveBeenCalled()
  })

  it('handleDeleteGroup() without members calls store.deleteAgentGroup immediately', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useAgentsStore()
    store.agentGroups = [{ id: 20, name: 'EmptyGroup', sort_order: 0, created_at: '', members: [] }]
    const deleteSpy = vi.spyOn(store, 'deleteAgentGroup').mockResolvedValue(undefined)

    const { confirmDeleteGroup, handleDeleteGroup } = useSidebarGroups()

    await handleDeleteGroup(20)

    expect(deleteSpy).toHaveBeenCalledWith(20)
    expect(confirmDeleteGroup.value).toBeNull()
  })

  it('handleDeleteGroup() for unknown groupId (no members found) calls deleteAgentGroup', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useAgentsStore()
    store.agentGroups = [] // group not in list -> members is [] via ?? []
    const deleteSpy = vi.spyOn(store, 'deleteAgentGroup').mockResolvedValue(undefined)

    const { handleDeleteGroup } = useSidebarGroups()
    await handleDeleteGroup(999)

    expect(deleteSpy).toHaveBeenCalledWith(999)
  })

  it('onConfirmDeleteGroup() is a no-op when confirmDeleteGroup is null', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useAgentsStore()
    const deleteSpy = vi.spyOn(store, 'deleteAgentGroup').mockResolvedValue(undefined)

    const { confirmDeleteGroup, onConfirmDeleteGroup } = useSidebarGroups()
    confirmDeleteGroup.value = null // already null

    await onConfirmDeleteGroup()

    expect(deleteSpy).not.toHaveBeenCalled()
  })
})
