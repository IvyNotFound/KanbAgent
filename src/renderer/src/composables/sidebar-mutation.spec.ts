/**
 * Mutation-focused tests for useSidebarGroups and useSidebarDragDrop (T1286)
 *
 * Targets surviving mutants from Stryker report:
 * - NoCoverage branches in useSidebarGroups: subgroup create/cancel, confirmRename empty trim
 * - NoCoverage branches in useSidebarDragDrop: onGroupDragStart, onGroupDragOver,
 *   onGroupDrop group reparenting (normal + same-group guard + groupId=0 guard)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  agentGroupsCreate: vi.fn().mockResolvedValue({ success: true, group: { id: 1, name: 'Sub', sort_order: 0, created_at: '' } }),
  agentGroupsRename: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsDelete: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetMember: vi.fn().mockResolvedValue({ success: true }),
  selectProjectDir: vi.fn().mockResolvedValue(null),
  showConfirmDialog: vi.fn().mockResolvedValue(true),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
  terminalKill: vi.fn(),
  findProjectDb: vi.fn().mockResolvedValue(null),
  getTaskLinks: vi.fn().mockResolvedValue({ success: true, links: [] }),
  getTaskAssignees: vi.fn().mockResolvedValue({ success: true, assignees: [] }),
  agentKill: vi.fn(),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})

// ─── useSidebarGroups mutation coverage ──────────────────────────────────────
describe('useSidebarGroups mutation coverage (T1286)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('confirmRename() with whitespace-only name does NOT call store.renameAgentGroup', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useTasksStore()
    const spy = vi.spyOn(store, 'renameAgentGroup').mockResolvedValue(undefined)

    const { renamingGroupId, renameGroupName, confirmRename } = useSidebarGroups()
    renamingGroupId.value = 5
    renameGroupName.value = '   ' // whitespace only — trim() yields ''

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
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useTasksStore()
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
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useTasksStore()
    const spy = vi.spyOn(store, 'createAgentGroup').mockResolvedValue(null)

    const { creatingSubgroupForId, newSubgroupName, confirmCreateSubgroup } = useSidebarGroups()
    creatingSubgroupForId.value = 7
    newSubgroupName.value = 'SubGroupName'

    await confirmCreateSubgroup()

    expect(spy).toHaveBeenCalledWith('SubGroupName', 7)
    expect(creatingSubgroupForId.value).toBeNull()
  })

  it('confirmCreateSubgroup() with empty name does NOT call store.createAgentGroup', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useTasksStore()
    const spy = vi.spyOn(store, 'createAgentGroup').mockResolvedValue(null)

    const { creatingSubgroupForId, newSubgroupName, confirmCreateSubgroup } = useSidebarGroups()
    creatingSubgroupForId.value = 7
    newSubgroupName.value = '' // empty

    await confirmCreateSubgroup()

    expect(spy).not.toHaveBeenCalled()
    expect(creatingSubgroupForId.value).toBeNull()
  })

  it('confirmCreateSubgroup() with null parentId does NOT call store.createAgentGroup', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useTasksStore()
    const spy = vi.spyOn(store, 'createAgentGroup').mockResolvedValue(null)

    const { creatingSubgroupForId, newSubgroupName, confirmCreateSubgroup } = useSidebarGroups()
    creatingSubgroupForId.value = null // no parent selected
    newSubgroupName.value = 'SubGroupName'

    await confirmCreateSubgroup()

    expect(spy).not.toHaveBeenCalled()
  })

  it('handleDeleteGroup() without members calls store.deleteAgentGroup immediately', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useTasksStore()
    store.agentGroups = [{ id: 20, name: 'EmptyGroup', sort_order: 0, created_at: '', members: [] }]
    const deleteSpy = vi.spyOn(store, 'deleteAgentGroup').mockResolvedValue(undefined)

    const { confirmDeleteGroup, handleDeleteGroup } = useSidebarGroups()

    await handleDeleteGroup(20)

    expect(deleteSpy).toHaveBeenCalledWith(20)
    expect(confirmDeleteGroup.value).toBeNull()
  })

  it('handleDeleteGroup() for unknown groupId (no members found) calls deleteAgentGroup', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useTasksStore()
    store.agentGroups = [] // group not in list → members is [] via ?? []
    const deleteSpy = vi.spyOn(store, 'deleteAgentGroup').mockResolvedValue(undefined)

    const { handleDeleteGroup } = useSidebarGroups()
    await handleDeleteGroup(999)

    expect(deleteSpy).toHaveBeenCalledWith(999)
  })

  it('onConfirmDeleteGroup() is a no-op when confirmDeleteGroup is null', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const store = useTasksStore()
    const deleteSpy = vi.spyOn(store, 'deleteAgentGroup').mockResolvedValue(undefined)

    const { confirmDeleteGroup, onConfirmDeleteGroup } = useSidebarGroups()
    confirmDeleteGroup.value = null // already null

    await onConfirmDeleteGroup()

    expect(deleteSpy).not.toHaveBeenCalled()
  })
})

// ─── useSidebarDragDrop mutation coverage ────────────────────────────────────
describe('useSidebarDragDrop mutation coverage (T1286)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  function makeDragEvent(overrides: { dataTransferData?: Record<string, string> } = {}): DragEvent {
    const data: Record<string, string> = overrides.dataTransferData ?? {}
    const dataTransfer = {
      setData: vi.fn((k: string, v: string) => { data[k] = v }),
      getData: vi.fn((k: string) => data[k] ?? ''),
      effectAllowed: '' as DataTransfer['effectAllowed'],
      dropEffect: '' as DataTransfer['dropEffect'],
    } as unknown as DataTransfer

    return {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer,
      currentTarget: document.createElement('div'),
      relatedTarget: null,
    } as unknown as DragEvent
  }

  it('onGroupDragStart() sets dragGroupId, clears dragAgentId, sets dataTransfer', async () => {
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')
    const { dragGroupId, dragAgentId, onGroupDragStart } = useSidebarDragDrop()

    dragAgentId.value = 5 // pre-set to verify it gets cleared

    const group = { id: 12, name: 'MyGroup' } as never
    const event = makeDragEvent()

    onGroupDragStart(event, group)

    expect(dragGroupId.value).toBe(12)
    expect(dragAgentId.value).toBeNull()
    expect(event.dataTransfer!.setData).toHaveBeenCalledWith('group-id', '12')
    expect(event.dataTransfer!.effectAllowed).toBe('move')
  })

  it('onGroupDragStart() calls event.stopPropagation()', async () => {
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')
    const { onGroupDragStart } = useSidebarDragDrop()

    const group = { id: 3, name: 'G' } as never
    const event = makeDragEvent()

    onGroupDragStart(event, group)

    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('onGroupDragOver() sets dragOverGroupId from numeric groupId', async () => {
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')
    const { dragOverGroupId, onGroupDragOver } = useSidebarDragDrop()

    const event = makeDragEvent()
    onGroupDragOver(event, 7)

    expect(dragOverGroupId.value).toBe(7)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.dataTransfer!.dropEffect).toBe('move')
  })

  it('onGroupDragOver() sets dragOverGroupId to __ungrouped__ when groupId is null', async () => {
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')
    const { dragOverGroupId, onGroupDragOver } = useSidebarDragDrop()

    const event = makeDragEvent()
    onGroupDragOver(event, null)

    expect(dragOverGroupId.value).toBe('__ungrouped__')
  })

  it('onGroupDrop() with group-id reparents correctly', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useTasksStore()
    const setParentSpy = vi.spyOn(store, 'setGroupParent').mockResolvedValue(undefined)

    const { dragGroupId, onGroupDrop } = useSidebarDragDrop()
    dragGroupId.value = 8
    const event = makeDragEvent({ dataTransferData: { 'group-id': '8' } })

    await onGroupDrop(event, 15) // groupId=8, targetGroupId=15

    expect(setParentSpy).toHaveBeenCalledWith(8, 15)
    expect(dragGroupId.value).toBeNull()
  })

  it('onGroupDrop() with group-id=targetGroupId does NOT reparent (same group guard)', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useTasksStore()
    const setParentSpy = vi.spyOn(store, 'setGroupParent').mockResolvedValue(undefined)

    const { onGroupDrop } = useSidebarDragDrop()
    const event = makeDragEvent({ dataTransferData: { 'group-id': '5' } })

    await onGroupDrop(event, 5) // groupId === targetGroupId — should be no-op

    expect(setParentSpy).not.toHaveBeenCalled()
  })

  it('onGroupDrop() with group-id="0" (falsy) does NOT call setGroupParent', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useTasksStore()
    const setParentSpy = vi.spyOn(store, 'setGroupParent').mockResolvedValue(undefined)
    const setAgentSpy = vi.spyOn(store, 'setAgentGroup').mockResolvedValue(undefined)

    const { onGroupDrop } = useSidebarDragDrop()
    const event = makeDragEvent({ dataTransferData: { 'group-id': '0' } })

    await onGroupDrop(event, 5)

    // group-id='0' → Number('0') = 0 → falsy → guard `if (!groupId)` triggers
    expect(setParentSpy).not.toHaveBeenCalled()
    // agent-id is '' so setAgentGroup should also not be called
    expect(setAgentSpy).not.toHaveBeenCalled()
  })

  it('onGroupDrop() resets dragOverGroupId to null on drop', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useTasksStore()
    vi.spyOn(store, 'setAgentGroup').mockResolvedValue(undefined)

    const { dragOverGroupId, onGroupDrop } = useSidebarDragDrop()
    dragOverGroupId.value = 3

    const event = makeDragEvent({ dataTransferData: { 'agent-id': '10' } })
    await onGroupDrop(event, 3)

    expect(dragOverGroupId.value).toBeNull()
  })

  it('onAgentDragStart() clears dragGroupId when starting agent drag', async () => {
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')
    const { dragAgentId, dragGroupId, onAgentDragStart } = useSidebarDragDrop()

    dragGroupId.value = 5 // pre-set to verify it gets cleared

    const agent = { id: 99, name: 'agent-y' } as never
    const event = makeDragEvent()

    onAgentDragStart(event, agent)

    expect(dragAgentId.value).toBe(99)
    expect(dragGroupId.value).toBeNull()
    expect(event.dataTransfer!.effectAllowed).toBe('move')
  })

  it('onGroupDrop() with null targetGroupId moves agent to ungrouped', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useTasksStore()
    const setAgentSpy = vi.spyOn(store, 'setAgentGroup').mockResolvedValue(undefined)

    const { onGroupDrop } = useSidebarDragDrop()
    const event = makeDragEvent({ dataTransferData: { 'agent-id': '20' } })

    await onGroupDrop(event, null)

    expect(setAgentSpy).toHaveBeenCalledWith(20, null)
  })

  it('onGroupDrop() after group reparent: dragGroupId is cleared to null', async () => {
    const { useTasksStore } = await import('@renderer/stores/tasks')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useTasksStore()
    vi.spyOn(store, 'setGroupParent').mockResolvedValue(undefined)

    const { dragGroupId, onGroupDrop } = useSidebarDragDrop()
    dragGroupId.value = 3
    const event = makeDragEvent({ dataTransferData: { 'group-id': '3' } })

    await onGroupDrop(event, 10)

    expect(dragGroupId.value).toBeNull()
  })

  it('onGroupDragLeave() with null relatedTarget (outside window) clears dragOverGroupId', async () => {
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')
    const { dragOverGroupId, onGroupDragLeave } = useSidebarDragDrop()

    dragOverGroupId.value = 8

    const container = document.createElement('div')
    const event = {
      currentTarget: container,
      relatedTarget: null, // dragging outside window
    } as unknown as DragEvent

    onGroupDragLeave(event)

    expect(dragOverGroupId.value).toBeNull()
  })
})
