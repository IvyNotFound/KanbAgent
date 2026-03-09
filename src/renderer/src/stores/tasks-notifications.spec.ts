import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
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


describe('stores/tasks — projectPath derivation from dbPath (mutation: EqualityOperator parts.length)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
    mockElectronAPI.findProjectDb.mockResolvedValue(null)
  })

  it('should derive projectPath from unix-style dbPath with .claude folder', async () => {
    localStorage.setItem('dbPath', '/home/user/myproject/.claude/project.db')

    useTasksStore()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(localStorage.getItem('projectPath')).toBe('/home/user/myproject')
  })

  it('should derive projectPath from WSL-style dbPath /mnt/c/.../.claude/project.db', async () => {
    localStorage.setItem('dbPath', '/mnt/c/Users/Cover/dev/kanbagent/.claude/project.db')

    useTasksStore()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(localStorage.getItem('projectPath')).toBe('/mnt/c/Users/Cover/dev/kanbagent')
  })

  it('should NOT derive projectPath when second-to-last segment is not .claude', async () => {
    localStorage.setItem('dbPath', '/home/user/myproject/other/project.db')

    useTasksStore()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(localStorage.getItem('projectPath')).toBeNull()
  })

  it('should NOT derive projectPath when dbPath has fewer than 2 segments', async () => {
    localStorage.setItem('dbPath', 'project.db')

    useTasksStore()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(localStorage.getItem('projectPath')).toBeNull()
  })

  it('should use existing projectPath from localStorage without re-deriving', async () => {
    localStorage.setItem('dbPath', '/home/user/myproject/.claude/project.db')
    localStorage.setItem('projectPath', '/existing/path')

    useTasksStore()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(localStorage.getItem('projectPath')).toBe('/existing/path')
  })
})


describe('stores/tasks — desktop notifications (mutation: LogicalOperator L163)', () => {
  const originalNotification = global.Notification

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  afterEach(() => {
    global.Notification = originalNotification
  })

  it('should fire notification when task transitions todo → done with permission granted', async () => {
    const mockNotificationCtor = vi.fn()
    ;(global as unknown as Record<string, unknown>).Notification = Object.assign(mockNotificationCtor, { permission: 'granted' })

    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    const settingsStore = useSettingsStore()
    settingsStore.notificationsEnabled = true

    // Use unique ids to avoid _lastNotifTs debounce cross-test pollution
    store.tasks = [{ id: 8001, title: 'Task A', status: 'todo', agent_assigned_id: null }] as never

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([]) // live tasks
      .mockResolvedValueOnce([{ id: 8001, title: 'Task A', status: 'done', agent_assigned_id: null }]) // done tasks
      .mockResolvedValueOnce([]) // agents
      .mockResolvedValueOnce([]) // stats
      .mockResolvedValueOnce([]) // perimetres
      .mockResolvedValueOnce([]) // boardAssignees

    await store.refresh()

    expect(mockNotificationCtor).toHaveBeenCalledWith('Task completed', expect.any(Object))
  })

  it('should NOT fire notification when notificationsEnabled is false', async () => {
    const mockNotificationCtor = vi.fn()
    ;(global as unknown as Record<string, unknown>).Notification = Object.assign(mockNotificationCtor, { permission: 'granted' })

    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    const settingsStore = useSettingsStore()
    settingsStore.notificationsEnabled = false

    store.tasks = [{ id: 8002, title: 'Task A', status: 'todo', agent_assigned_id: null }] as never

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 8002, title: 'Task A', status: 'done', agent_assigned_id: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await store.refresh()

    expect(mockNotificationCtor).not.toHaveBeenCalled()
  })

  it('should NOT fire notification when Notification.permission is not granted', async () => {
    const mockNotificationCtor = vi.fn()
    ;(global as unknown as Record<string, unknown>).Notification = Object.assign(mockNotificationCtor, { permission: 'denied' })

    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    const settingsStore = useSettingsStore()
    settingsStore.notificationsEnabled = true

    store.tasks = [{ id: 8003, title: 'Task A', status: 'todo', agent_assigned_id: null }] as never

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 8003, title: 'Task A', status: 'done', agent_assigned_id: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await store.refresh()

    expect(mockNotificationCtor).not.toHaveBeenCalled()
  })

  it('should NOT fire notification when tasks.value was empty before refresh (first load)', async () => {
    const mockNotificationCtor = vi.fn()
    ;(global as unknown as Record<string, unknown>).Notification = Object.assign(mockNotificationCtor, { permission: 'granted' })

    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    const settingsStore = useSettingsStore()
    settingsStore.notificationsEnabled = true

    store.tasks = [] as never

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 8004, title: 'Task A', status: 'done', agent_assigned_id: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await store.refresh()

    expect(mockNotificationCtor).not.toHaveBeenCalled()
  })

  it('should NOT fire notification when task status did not change', async () => {
    const mockNotificationCtor = vi.fn()
    ;(global as unknown as Record<string, unknown>).Notification = Object.assign(mockNotificationCtor, { permission: 'granted' })

    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    const settingsStore = useSettingsStore()
    settingsStore.notificationsEnabled = true

    store.tasks = [{ id: 8005, title: 'Task A', status: 'done', agent_assigned_id: null }] as never

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 8005, title: 'Task A', status: 'done', agent_assigned_id: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await store.refresh()

    expect(mockNotificationCtor).not.toHaveBeenCalled()
  })

  it('should fire "Task started" notification when task transitions to in_progress', async () => {
    const mockNotificationCtor = vi.fn()
    ;(global as unknown as Record<string, unknown>).Notification = Object.assign(mockNotificationCtor, { permission: 'granted' })

    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    const settingsStore = useSettingsStore()
    settingsStore.notificationsEnabled = true

    // Use unique task id to avoid cross-test debounce pollution (_lastNotifTs is module-level)
    store.tasks = [{ id: 9999, title: 'Task B', status: 'todo', agent_assigned_id: null }] as never

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([{ id: 9999, title: 'Task B', status: 'in_progress', agent_assigned_id: null }]) // live tasks
      .mockResolvedValueOnce([]) // done tasks
      .mockResolvedValueOnce([]) // agents
      .mockResolvedValueOnce([]) // stats
      .mockResolvedValueOnce([]) // perimetres
      .mockResolvedValueOnce([]) // boardAssignees

    await store.refresh()

    expect(mockNotificationCtor).toHaveBeenCalledWith('Task started', expect.any(Object))
  })
})
