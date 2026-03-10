/**
 * Tests for composables: useToolStats, useToast, useConfirmDialog,
 * useSidebarGroups, useSidebarDragDrop (T840)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

// ─── Mock electronAPI ────────────────────────────────────────────────────────
const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  agentGroupsCreate: vi.fn().mockResolvedValue({ success: true, group: { id: 1, name: 'NewGroup', sort_order: 0, created_at: '' } }),
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

// ─── useSidebarGroups ─────────────────────────────────────────────────────────
describe('useSidebarGroups (T840)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('startRename() populates renamingGroupId and renameGroupName', async () => {
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')
    const { renamingGroupId, renameGroupName, startRename } = useSidebarGroups()

    expect(renamingGroupId.value).toBeNull()

    await startRename({ id: 5, name: 'MyGroup' })

    expect(renamingGroupId.value).toBe(5)
    expect(renameGroupName.value).toBe('MyGroup')
  })

  it('cancelRename() sets renamingGroupId back to null', async () => {
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')
    const { renamingGroupId, startRename, cancelRename } = useSidebarGroups()

    await startRename({ id: 3, name: 'ToCancel' })
    expect(renamingGroupId.value).toBe(3)

    cancelRename()
    expect(renamingGroupId.value).toBeNull()
  })

  it('confirmRename() calls store.renameAgentGroup IPC and resets renamingGroupId', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const agentsStore = useAgentsStore()
    const spy = vi.spyOn(agentsStore, 'renameAgentGroup').mockResolvedValue(undefined)

    const { renamingGroupId, renameGroupName, confirmRename } = useSidebarGroups()
    renamingGroupId.value = 7
    renameGroupName.value = 'NewName'

    await confirmRename(7)

    expect(spy).toHaveBeenCalledWith(7, 'NewName')
    expect(renamingGroupId.value).toBeNull()
  })

  it('confirmCreateGroup() with empty name does not call store.createAgentGroup', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const agentsStore = useAgentsStore()
    const spy = vi.spyOn(agentsStore, 'createAgentGroup').mockResolvedValue(null)

    const { newGroupName, confirmCreateGroup } = useSidebarGroups()
    newGroupName.value = '   ' // whitespace only

    await confirmCreateGroup()

    expect(spy).not.toHaveBeenCalled()
  })

  it('handleDeleteGroup() with members sets confirmDeleteGroup (does not delete immediately)', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const agentsStore = useAgentsStore()
    agentsStore.agentGroups = [{ id: 10, name: 'GroupWithMembers', sort_order: 0, created_at: '', members: [{ agent_id: 1, sort_order: 0 }] }]
    const deleteSpy = vi.spyOn(agentsStore, 'deleteAgentGroup').mockResolvedValue(undefined)

    const { confirmDeleteGroup, handleDeleteGroup } = useSidebarGroups()

    await handleDeleteGroup(10)

    expect(confirmDeleteGroup.value).toEqual({ groupId: 10 })
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('onConfirmDeleteGroup() calls store.deleteAgentGroup and clears confirmDeleteGroup', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarGroups } = await import('@renderer/composables/useSidebarGroups')

    const agentsStore = useAgentsStore()
    const deleteSpy = vi.spyOn(agentsStore, 'deleteAgentGroup').mockResolvedValue(undefined)

    const { confirmDeleteGroup, onConfirmDeleteGroup } = useSidebarGroups()
    confirmDeleteGroup.value = { groupId: 42 }

    await onConfirmDeleteGroup()

    expect(deleteSpy).toHaveBeenCalledWith(42)
    expect(confirmDeleteGroup.value).toBeNull()
  })
})

// ─── useSidebarDragDrop ───────────────────────────────────────────────────────
describe('useSidebarDragDrop (T840)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  function makeDragEvent(overrides: Partial<DragEvent> & { dataTransferData?: Record<string, string> }): DragEvent {
    const data: Record<string, string> = overrides.dataTransferData ?? {}
    const dataTransfer = {
      setData: vi.fn((k: string, v: string) => { data[k] = v }),
      getData: vi.fn((k: string) => data[k] ?? ''),
      effectAllowed: '',
      dropEffect: '',
    } as unknown as DataTransfer

    return {
      preventDefault: vi.fn(),
      dataTransfer,
      currentTarget: document.createElement('div'),
      relatedTarget: null,
      ...overrides,
    } as unknown as DragEvent
  }

  it('onAgentDragStart() sets dragAgentId and stores data in dataTransfer', async () => {
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')
    const { dragAgentId, onAgentDragStart } = useSidebarDragDrop()

    const agent = { id: 7, name: 'agent-x' } as never
    const event = makeDragEvent({})

    onAgentDragStart(event, agent)

    expect(dragAgentId.value).toBe(7)
    expect(event.dataTransfer!.setData).toHaveBeenCalledWith('agent-id', '7')
  })

  it('onGroupDrop() with valid agentId calls store.setAgentGroup', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const agentsStore = useAgentsStore()
    const setSpy = vi.spyOn(agentsStore, 'setAgentGroup').mockResolvedValue(undefined)

    const { onGroupDrop } = useSidebarDragDrop()
    const event = makeDragEvent({ dataTransferData: { 'agent-id': '42' } })

    await onGroupDrop(event, 3)

    expect(setSpy).toHaveBeenCalledWith(42, 3)
  })

  it('onGroupDrop() with agentId=0 (empty string) does not call setAgentGroup', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const agentsStore = useAgentsStore()
    const setSpy = vi.spyOn(agentsStore, 'setAgentGroup').mockResolvedValue(undefined)

    const { onGroupDrop } = useSidebarDragDrop()
    const event = makeDragEvent({ dataTransferData: { 'agent-id': '' } })

    await onGroupDrop(event, 3)

    expect(setSpy).not.toHaveBeenCalled()
  })

  it('onGroupDragLeave() clears dragOverGroupId when relatedTarget is outside', async () => {
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')
    const { dragOverGroupId, onGroupDragLeave } = useSidebarDragDrop()

    dragOverGroupId.value = 5

    const container = document.createElement('div')
    const event = {
      currentTarget: container,
      relatedTarget: document.createElement('span'), // outside container
    } as unknown as DragEvent

    onGroupDragLeave(event)

    expect(dragOverGroupId.value).toBeNull()
  })

  it('onGroupDragLeave() does NOT clear dragOverGroupId when relatedTarget is inside', async () => {
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')
    const { dragOverGroupId, onGroupDragLeave } = useSidebarDragDrop()

    dragOverGroupId.value = 5

    const container = document.createElement('div')
    const child = document.createElement('span')
    container.appendChild(child)

    const event = {
      currentTarget: container,
      relatedTarget: child, // inside container
    } as unknown as DragEvent

    onGroupDragLeave(event)

    // should NOT clear since relatedTarget is inside
    expect(dragOverGroupId.value).toBe(5)
  })
})
