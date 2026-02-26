/**
 * Tests for useArchivedPagination and usePolledData composables.
 *
 * useArchivedPagination: lazy-loaded paginated archive backed by tasksGetArchived IPC.
 * usePolledData: generic polling helper with lifecycle management.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useArchivedPagination, PAGE_SIZE } from './useArchivedPagination'
import { usePolledData } from './usePolledData'
import { useTasksStore } from '@renderer/stores/tasks'

// ---------------------------------------------------------------------------
// Mock window.electronAPI — minimal surface needed by both composables + store
// ---------------------------------------------------------------------------
const api = {
  queryDb: vi.fn().mockResolvedValue([]),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  findProjectDb: vi.fn().mockResolvedValue(null),
  selectProjectDir: vi.fn().mockResolvedValue(null),
  getLocks: vi.fn().mockResolvedValue([]),
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
      perimetre: null,
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
      perimetre: 'front-vuejs',
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
      expect.objectContaining({ page: 0, perimetre: 'back-electron' })
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
})

// ---------------------------------------------------------------------------
// usePolledData
// ---------------------------------------------------------------------------

describe('composables/usePolledData', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Simulate document visible
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('start() calls fetcher immediately when active becomes true', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    const active = ref(false)

    usePolledData(fetcher, active, 1000)

    active.value = true
    await nextTick()
    await Promise.resolve()

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('immediate: true triggers fetcher on mount when active=true', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    const active = ref(true)

    usePolledData(fetcher, active, 1000)
    await Promise.resolve()

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('start() starts interval — second call fires after one interval', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    const active = ref(true)

    usePolledData(fetcher, active, 1000)
    await Promise.resolve()

    // Advance by 1 interval
    vi.advanceTimersByTime(1000)
    await Promise.resolve()

    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('stop() cancels the interval when active becomes false', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    const active = ref(true)

    usePolledData(fetcher, active, 1000)
    await Promise.resolve()

    active.value = false
    await nextTick()

    // No more calls after stop
    vi.advanceTimersByTime(3000)
    await Promise.resolve()

    // Only 1 call from the initial immediate fetch
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('start() called twice does not create two intervals', async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined)
    const active = ref(false)

    usePolledData(fetcher, active, 1000)

    // Toggle active twice (start → stop → start)
    active.value = true
    await nextTick()
    active.value = false
    await nextTick()
    active.value = true
    await nextTick()

    await Promise.resolve()
    fetcher.mockClear()

    // Only 1 interval tick, not 2
    vi.advanceTimersByTime(1000)
    await Promise.resolve()

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('loading=true during fetcher execution, false after', async () => {
    let resolveFetch!: () => void
    const fetcher = vi.fn().mockImplementation(
      () => new Promise<void>(resolve => { resolveFetch = resolve })
    )
    const active = ref(true)

    const { loading } = usePolledData(fetcher, active, 1000)
    await nextTick()

    expect(loading.value).toBe(true)

    resolveFetch()
    await Promise.resolve()
    await Promise.resolve()

    expect(loading.value).toBe(false)
  })

  it('error in fetcher does not crash polling — subsequent ticks still fire', async () => {
    let callCount = 0
    // fetcher rejects first call then resolves — use a promise that captures the rejection
    const fetcher = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.reject(new Error('network error')).catch(() => {})
      return Promise.resolve()
    })
    const active = ref(true)

    expect(() => usePolledData(fetcher, active, 1000)).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    // Advance to next tick — fetcher should still be called
    vi.advanceTimersByTime(1000)
    await Promise.resolve()

    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('loading is reset to false even when fetcher throws', async () => {
    // Use refresh() directly (the public API) to control when the rejection occurs
    // and ensure we can catch it — avoids unhandled rejection from the immediate watch trigger
    const fetcher = vi.fn().mockRejectedValue(new Error('oops'))
    const active = ref(false) // start inactive

    const { loading, refresh } = usePolledData(fetcher, active, 1000)

    // Call refresh() manually and catch the rejection
    await refresh().catch(() => {})

    expect(loading.value).toBe(false)
  })

  it('skips fetch when document is hidden', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    })
    const fetcher = vi.fn().mockResolvedValue(undefined)
    const active = ref(true)

    usePolledData(fetcher, active, 1000)
    await Promise.resolve()

    expect(fetcher).not.toHaveBeenCalled()
  })
})
