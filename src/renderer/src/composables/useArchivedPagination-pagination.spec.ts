/**
 * Tests for useArchivedPagination composable.
 *
 * useArchivedPagination: lazy-loaded paginated archive backed by tasksGetArchived IPC.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useArchivedPagination, PAGE_SIZE } from './useArchivedPagination'
import { useTasksStore } from '@renderer/stores/tasks'

// ---------------------------------------------------------------------------
// Mock window.electronAPI — minimal surface needed by composable + store
// ---------------------------------------------------------------------------
const api = {
  queryDb: vi.fn().mockResolvedValue([]),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  findProjectDb: vi.fn().mockResolvedValue(null),
  selectProjectDir: vi.fn().mockResolvedValue(null),
  tasksGetArchived: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
}

Object.defineProperty(window, 'electronAPI', { value: api, writable: true })

// ---------------------------------------------------------------------------
// useArchivedPagination
// ---------------------------------------------------------------------------

describe('composables/useArchivedPagination', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    api.queryDb.mockResolvedValue([])
    api.migrateDb.mockResolvedValue({ success: true })
    api.watchDb.mockResolvedValue(undefined)
    api.onDbChanged.mockReturnValue(() => {})
    api.tasksGetArchived.mockResolvedValue({ rows: [], total: 0 })
  })

  function setupStore(dbPathValue: string | null = '/project/.claude/project.db') {
    const store = useTasksStore()
    ;(store as unknown as { dbPath: string | null }).dbPath = dbPathValue
    return store
  }

  it('loadPage(0) calls tasksGetArchived with page=0 and pageSize=50', async () => {
    const store = setupStore()
    store.selectedAgentId = null
    store.selectedPerimetre = null

    const { loadPage } = useArchivedPagination()
    await loadPage(0)

    expect(api.tasksGetArchived).toHaveBeenCalledWith('/project/.claude/project.db', {
      page: 0,
      pageSize: PAGE_SIZE,
      agentId: null,
      scope: null,
    })
  })

  it('loadPage passes agentId and perimetre from store filters', async () => {
    const store = setupStore()
    store.selectedAgentId = 5
    store.selectedPerimetre = 'front-vuejs'

    const { loadPage } = useArchivedPagination()
    await loadPage(0)

    expect(api.tasksGetArchived).toHaveBeenCalledWith('/project/.claude/project.db', {
      page: 0,
      pageSize: PAGE_SIZE,
      agentId: 5,
      scope: 'front-vuejs',
    })
  })

  it('archivedTasks and total are updated after successful loadPage', async () => {
    const mockRow = { id: 1, titre: 'Task A', statut: 'archived' }
    api.tasksGetArchived.mockResolvedValue({ rows: [mockRow], total: 1 })
    setupStore()

    const { archivedTasks, total, loadPage } = useArchivedPagination()
    await loadPage(0)

    expect(archivedTasks.value).toHaveLength(1)
    expect(archivedTasks.value[0]).toMatchObject({ id: 1, titre: 'Task A' })
    expect(total.value).toBe(1)
  })

  it('totalPages is calculated correctly (total=55, pageSize=50 → 2)', async () => {
    api.tasksGetArchived.mockResolvedValue({ rows: [], total: 55 })
    setupStore()

    const { totalPages, loadPage } = useArchivedPagination()
    await loadPage(0)

    expect(totalPages.value).toBe(2)
  })

  it('totalPages is at least 1 when total=0', async () => {
    api.tasksGetArchived.mockResolvedValue({ rows: [], total: 0 })
    setupStore()

    const { totalPages, loadPage } = useArchivedPagination()
    await loadPage(0)

    expect(totalPages.value).toBe(1)
  })

  it('loading=true during loadPage, false after', async () => {
    let resolveApi!: (v: { rows: unknown[]; total: number }) => void
    api.tasksGetArchived.mockReturnValue(
      new Promise<{ rows: unknown[]; total: number }>(resolve => { resolveApi = resolve })
    )
    setupStore()

    const { loading, loadPage } = useArchivedPagination()

    const promise = loadPage(0)
    expect(loading.value).toBe(true)

    resolveApi({ rows: [], total: 0 })
    await promise

    expect(loading.value).toBe(false)
  })

  it('returns empty page without crash when dbPath is null', async () => {
    setupStore(null)
    const { archivedTasks, total, loadPage } = useArchivedPagination()

    await loadPage(0)

    expect(api.tasksGetArchived).not.toHaveBeenCalled()
    expect(archivedTasks.value).toHaveLength(0)
    expect(total.value).toBe(0)
  })

  it('normalizeRow passes through string and number values unchanged', async () => {
    const mockRow = { id: 42, titre: 'Task String', statut: 'archived' }
    api.tasksGetArchived.mockResolvedValue({ rows: [mockRow], total: 1 })
    setupStore()

    const { archivedTasks, loadPage } = useArchivedPagination()
    await loadPage(0)

    expect(archivedTasks.value[0].titre).toBe('Task String')
    expect(archivedTasks.value[0].id).toBe(42)
  })

  it('resets page to 0 and reloads when selectedAgentId changes', async () => {
    const store = setupStore()
    const { loadPage } = useArchivedPagination()

    // Trigger first load to enable auto-reload guard
    await loadPage(2)
    api.tasksGetArchived.mockClear()

    // Change selectedAgentId — triggers watcher
    store.selectedAgentId = 7
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(api.tasksGetArchived).toHaveBeenCalledWith(
      '/project/.claude/project.db',
      expect.objectContaining({ page: 0, agentId: 7 })
    )
  })

  it('resets page to 0 and reloads when selectedPerimetre changes', async () => {
    const store = setupStore()
    const { loadPage } = useArchivedPagination()

    await loadPage(2)
    api.tasksGetArchived.mockClear()

    store.selectedPerimetre = 'back-electron'
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(api.tasksGetArchived).toHaveBeenCalledWith(
      '/project/.claude/project.db',
      expect.objectContaining({ page: 0, scope: 'back-electron' })
    )
  })

  it('does NOT auto-reload on filter change before first loadPage call', async () => {
    const store = setupStore()
    // Do NOT call loadPage — hasLoaded guard should prevent auto-reload
    useArchivedPagination()

    store.selectedAgentId = 3
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(api.tasksGetArchived).not.toHaveBeenCalled()
  })

  it('loadPage error path: loading is false after rejection, no unhandled throw', async () => {
    api.tasksGetArchived.mockRejectedValue(new Error('IPC rejected'))
    setupStore()

    const { loading, archivedTasks, total, loadPage } = useArchivedPagination()

    // Should not throw — error is caught internally
    await loadPage(0)

    expect(loading.value).toBe(false)
    // Data stays at initial values on error
    expect(archivedTasks.value).toHaveLength(0)
    expect(total.value).toBe(0)
  })

  it('loadPage(3) sets page.value to 3', async () => {
    setupStore()
    const { page, loadPage } = useArchivedPagination()

    await loadPage(3)

    expect(page.value).toBe(3)
  })

  it('watch lastRefresh: change triggers loadPage with current page', async () => {
    const store = setupStore()
    const { loadPage } = useArchivedPagination()

    // First load to enable the guard
    await loadPage(2)
    api.tasksGetArchived.mockClear()

    // Simulate a DB refresh event
    store.lastRefresh = new Date()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(api.tasksGetArchived).toHaveBeenCalledWith(
      '/project/.claude/project.db',
      expect.objectContaining({ page: 2 })
    )
  })

  it('watch lastRefresh: does NOT reload before first loadPage call', async () => {
    const store = setupStore()
    // Do NOT call loadPage — hasLoaded guard should prevent reload
    useArchivedPagination()

    store.lastRefresh = new Date()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(api.tasksGetArchived).not.toHaveBeenCalled()
  })
})
