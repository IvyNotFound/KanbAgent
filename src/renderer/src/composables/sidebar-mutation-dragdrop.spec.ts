/**
 * Mutation-focused tests for useSidebarDragDrop (T1286)
 *
 * Targets surviving mutants from Stryker report:
 * - NoCoverage branches in useSidebarDragDrop: onGroupDragStart, onGroupDragOver,
 *   onGroupDrop group reparenting (normal + same-group guard + groupId=0 guard)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { installMockElectronAPI } from './__helpers__/sidebar-mutation.helpers'

installMockElectronAPI()

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

// ---- useSidebarDragDrop mutation coverage ----
describe('useSidebarDragDrop mutation coverage (T1286)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('dbPath', '/test/project.db')
  })

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
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useAgentsStore()
    const setParentSpy = vi.spyOn(store, 'setGroupParent').mockResolvedValue(undefined)

    const { dragGroupId, onGroupDrop } = useSidebarDragDrop()
    dragGroupId.value = 8
    const event = makeDragEvent({ dataTransferData: { 'group-id': '8' } })

    await onGroupDrop(event, 15) // groupId=8, targetGroupId=15

    expect(setParentSpy).toHaveBeenCalledWith(8, 15)
    expect(dragGroupId.value).toBeNull()
  })

  it('onGroupDrop() with group-id=targetGroupId does NOT reparent (same group guard)', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useAgentsStore()
    const setParentSpy = vi.spyOn(store, 'setGroupParent').mockResolvedValue(undefined)

    const { onGroupDrop } = useSidebarDragDrop()
    const event = makeDragEvent({ dataTransferData: { 'group-id': '5' } })

    await onGroupDrop(event, 5) // groupId === targetGroupId -- should be no-op

    expect(setParentSpy).not.toHaveBeenCalled()
  })

  it('onGroupDrop() with group-id="0" (falsy) does NOT call setGroupParent', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useAgentsStore()
    const setParentSpy = vi.spyOn(store, 'setGroupParent').mockResolvedValue(undefined)
    const setAgentSpy = vi.spyOn(store, 'setAgentGroup').mockResolvedValue(undefined)

    const { onGroupDrop } = useSidebarDragDrop()
    const event = makeDragEvent({ dataTransferData: { 'group-id': '0' } })

    await onGroupDrop(event, 5)

    // group-id='0' -> Number('0') = 0 -> falsy -> guard `if (!groupId)` triggers
    expect(setParentSpy).not.toHaveBeenCalled()
    // agent-id is '' so setAgentGroup should also not be called
    expect(setAgentSpy).not.toHaveBeenCalled()
  })

  it('onGroupDrop() resets dragOverGroupId to null on drop', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useAgentsStore()
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
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useAgentsStore()
    const setAgentSpy = vi.spyOn(store, 'setAgentGroup').mockResolvedValue(undefined)

    const { onGroupDrop } = useSidebarDragDrop()
    const event = makeDragEvent({ dataTransferData: { 'agent-id': '20' } })

    await onGroupDrop(event, null)

    expect(setAgentSpy).toHaveBeenCalledWith(20, null)
  })

  it('onGroupDrop() after group reparent: dragGroupId is cleared to null', async () => {
    const { useAgentsStore } = await import('@renderer/stores/agents')
    const { useSidebarDragDrop } = await import('@renderer/composables/useSidebarDragDrop')

    const store = useAgentsStore()
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
