/**
 * tasks-gaps.spec.ts
 * Coverage gaps for tasks.ts — closeTask clears taskLinks/taskAssignees,
 * auto-start block path derivation,
 * watchForDb clears previous interval.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '@renderer/stores/tasks'

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
  agentGroupsCreate: vi.fn().mockResolvedValue({ success: true, group: { id: 1, name: 'G', sort_order: 0, created_at: '' } }),
  agentGroupsRename: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsDelete: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetMember: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetParent: vi.fn().mockResolvedValue({ success: true }),
  getConfigValue: vi.fn().mockResolvedValue({ success: false, value: null }),
  agentKill: vi.fn(),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})


// ─── closeTask: clears taskLinks and taskAssignees ────────────────────────────

describe('tasks — closeTask clears taskLinks and taskAssignees', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
    mockElectronAPI.getTaskLinks.mockResolvedValue({ success: true, links: [] })
    mockElectronAPI.getTaskAssignees.mockResolvedValue({ success: true, assignees: [] })
  })

  it('clears taskLinks on closeTask', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    const links = [{ id: 1, from_task_id: 1, to_task_id: 2, type: 'blocks' }]
    mockElectronAPI.getTaskLinks.mockResolvedValue({ success: true, links })

    await store.openTask({ id: 1, title: 'T' } as never)
    expect(store.taskLinks).toHaveLength(1)

    store.closeTask()

    expect(store.taskLinks).toHaveLength(0)
  })

  it('clears taskAssignees on closeTask', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    const assignees = [{ agent_id: 5, agent_name: 'dev', role: 'primary', assigned_at: '' }]
    mockElectronAPI.getTaskAssignees.mockResolvedValue({ success: true, assignees })

    await store.openTask({ id: 1, title: 'T' } as never)
    expect(store.taskAssignees).toHaveLength(1)

    store.closeTask()

    expect(store.taskAssignees).toHaveLength(0)
  })

  it('clears selectedTask on closeTask', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')

    await store.openTask({ id: 42, title: 'My Task' } as never)
    expect(store.selectedTask?.id).toBe(42)

    store.closeTask()

    expect(store.selectedTask).toBeNull()
  })

  it('clears taskComments on closeTask', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    mockElectronAPI.queryDb.mockResolvedValue([{ id: 1, content: 'comment' }])

    await store.openTask({ id: 1, title: 'T' } as never)

    store.closeTask()

    expect(store.taskComments).toHaveLength(0)
  })
})



// ─── watchForDb: clears previous interval when called twice ──────────────────

describe('tasks — watchForDb clears previous interval (NoCoverage)', () => {
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

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calling watchForDb twice does not double-fire the interval', async () => {
    vi.useFakeTimers()
    const store = useTasksStore()

    store.watchForDb('/project-a')
    store.watchForDb('/project-b') // replaces previous interval

    await vi.advanceTimersByTimeAsync(2000)

    // Only the second watchForDb path should fire — findProjectDb called with project-b only
    const calls = mockElectronAPI.findProjectDb.mock.calls
    const pathsChecked = calls.map(c => c[0])
    expect(pathsChecked.some(p => p === '/project-b')).toBe(true)
    // project-a interval was cancelled before it fired
    expect(pathsChecked.some(p => p === '/project-a')).toBe(false)
  })

  it('stops watching after findProjectDb returns a db path', async () => {
    vi.useFakeTimers()
    const store = useTasksStore()
    mockElectronAPI.findProjectDb.mockResolvedValue('/project/.claude/project.db')

    store.watchForDb('/project')
    await vi.advanceTimersByTimeAsync(2000)

    // Once db is found, setProject is called
    expect(mockElectronAPI.migrateDb).toHaveBeenCalledWith('/project/.claude/project.db')

    // Advance further — no more findProjectDb calls (interval cleared)
    const callsBefore = mockElectronAPI.findProjectDb.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockElectronAPI.findProjectDb.mock.calls.length).toBe(callsBefore)
  })
})


// ─── auto-start block: projectPath derivation from dbPath ────────────────────

describe('tasks — auto-start block projectPath derivation (NoCoverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
    mockElectronAPI.findProjectDb.mockResolvedValue(null)
  })

  it('derives projectPath from dbPath with .claude pattern on store init', () => {
    localStorage.clear()
    localStorage.setItem('dbPath', '/my/project/.claude/project.db')
    // No projectPath in localStorage

    setActivePinia(createPinia())
    const store = useTasksStore()

    // projectPath should be derived as '/my/project'
    expect(store.projectPath).toBe('/my/project')
    expect(localStorage.getItem('projectPath')).toBe('/my/project')
  })

  it('does NOT derive projectPath when dbPath does not match .claude pattern', () => {
    localStorage.clear()
    localStorage.setItem('dbPath', '/custom/path/custom.db')
    // No projectPath in localStorage

    setActivePinia(createPinia())
    const store = useTasksStore()

    // No derivation — projectPath remains null
    expect(store.projectPath).toBeNull()
  })

  it('does not overwrite existing projectPath with derivation', () => {
    localStorage.clear()
    localStorage.setItem('dbPath', '/my/project/.claude/project.db')
    localStorage.setItem('projectPath', '/already/set')

    setActivePinia(createPinia())
    const store = useTasksStore()

    // Should keep existing value, not override
    expect(store.projectPath).toBe('/already/set')
  })
})
