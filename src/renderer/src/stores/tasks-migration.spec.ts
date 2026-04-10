/**
 * tasks-migration.spec.ts
 * Tests that migrateDb failures are surfaced via migrationError (T1914).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
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


describe('tasks — migrationError (T1914)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('migrationError is null initially', () => {
    const store = useTasksStore()
    expect(store.migrationError).toBeNull()
  })

  it('sets migrationError when migrateDb returns { success: false } in setProject', async () => {
    const store = useTasksStore()
    mockElectronAPI.migrateDb.mockResolvedValueOnce({ success: false, error: 'Schema v99 not supported' })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await store.setProject('/p', '/p/.claude/project.db')

    expect(store.migrationError).toBe('Schema v99 not supported')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('migration failed'),
      'Schema v99 not supported',
    )
    errorSpy.mockRestore()
  })

  it('uses fallback message when migrateDb returns { success: false } without error string', async () => {
    const store = useTasksStore()
    mockElectronAPI.migrateDb.mockResolvedValueOnce({ success: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await store.setProject('/p', '/p/.claude/project.db')

    expect(store.migrationError).toBe('Migration failed')
    vi.restoreAllMocks()
  })

  it('clears migrationError on successful migration in setProject', async () => {
    const store = useTasksStore()
    // First: fail
    mockElectronAPI.migrateDb.mockResolvedValueOnce({ success: false, error: 'fail' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await store.setProject('/p', '/p/.claude/project.db')
    expect(store.migrationError).toBe('fail')

    // Second: succeed
    mockElectronAPI.migrateDb.mockResolvedValueOnce({ success: true })
    await store.setProject('/p2', '/p2/.claude/project.db')
    expect(store.migrationError).toBeNull()
    vi.restoreAllMocks()
  })

  it('does not crash the app when migration fails — refresh still runs', async () => {
    const store = useTasksStore()
    mockElectronAPI.migrateDb.mockResolvedValueOnce({ success: false, error: 'broken' })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await store.setProject('/p', '/p/.claude/project.db')

    // refresh was still called (queryDb invoked)
    expect(mockElectronAPI.queryDb).toHaveBeenCalled()
    // Store is functional — not crashed
    expect(store.tasks).toEqual([])
    vi.restoreAllMocks()
  })
})
