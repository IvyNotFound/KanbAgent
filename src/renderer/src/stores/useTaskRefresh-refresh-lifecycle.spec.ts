/**
 * useTaskRefresh-refresh-lifecycle.spec.ts — T1959
 *
 * Covers:
 * - refresh: sets loading=true during fetch, false in finally
 * - refresh: populates tasks, agents, perimetresData, stats, lastRefresh on success
 * - refresh: error during query → sets deps.error, calls pushToast
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { installElectronAPIMock, makeDeps } from './__helpers__/useTaskRefresh.helpers'

installElectronAPIMock()

vi.mock('@renderer/stores/agents', () => ({
  useAgentsStore: () => ({
    fetchAgentGroups: vi.fn(),
    agentRefresh: vi.fn(),
  }),
  AGENT_CTE_SQL: 'SELECT * FROM agents',
}))

vi.mock('@renderer/stores/settings', () => ({
  useSettingsStore: () => ({
    notificationsEnabled: false,
  }),
}))

const mockPushToast = vi.fn()
vi.mock('@renderer/composables/useToast', () => ({
  useToast: () => ({
    push: mockPushToast,
  }),
}))

// ─── loading flag ──────────────────────────────────────────────────────────────

describe('useTaskRefresh — refresh: loading flag (L48-L49)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('loading is false before refresh', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    useTaskRefresh(deps)
    expect(deps.loading.value).toBe(false)
  })

  it('loading is false after successful refresh (set false in finally)', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { refresh } = useTaskRefresh(deps)
    await refresh()
    expect(deps.loading.value).toBe(false)
  })

  it('loading is false after failed refresh (finally branch)', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps({
      query: vi.fn().mockRejectedValue(new Error('DB error')),
    })
    const { refresh } = useTaskRefresh(deps)
    await refresh()
    expect(deps.loading.value).toBe(false)
  })

  it('loading transitions true→false across a successful refresh', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const loadingStates: boolean[] = []
    const loadingRef = ref(false)

    // Intercept by observing the ref during query execution
    const queryMock = vi.fn().mockImplementation(() => {
      loadingStates.push(loadingRef.value)
      return Promise.resolve([])
    })

    const deps = makeDeps({ loading: loadingRef, query: queryMock })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    // During query calls, loading should have been true
    expect(loadingStates.some(v => v === true)).toBe(true)
    // After refresh, loading is false
    expect(loadingRef.value).toBe(false)
  })
})

// ─── data population ──────────────────────────────────────────────────────────

describe('useTaskRefresh — refresh: data population on success (L86-L135)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('populates tasks from live + done query results', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("status IN ('todo', 'in_progress')"))
          return Promise.resolve([{ id: 1, title: 'Live Task', status: 'in_progress' }])
        if (sql.includes("status = 'done'"))
          return Promise.resolve([{ id: 2, title: 'Done Task', status: 'done' }])
        return Promise.resolve([])
      }),
    })

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(deps.tasks.value).toHaveLength(2)
    expect(deps.tasks.value.map((t: { id: number }) => t.id)).toContain(1)
    expect(deps.tasks.value.map((t: { id: number }) => t.id)).toContain(2)
  })

  it('populates agents from AGENT_CTE_SQL result', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const agentRow = { id: 10, name: 'dev-agent', scope: 'front-vuejs' }
    const deps = makeDeps({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM agents')) return Promise.resolve([agentRow])
        return Promise.resolve([])
      }),
    })

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(deps.agents.value).toContainEqual(agentRow)
  })

  it('populates perimetresData from scopes query', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const scope = { id: 3, name: 'front-vuejs', folder: '/src', techno: 'vue', description: '', active: 1 }
    const deps = makeDeps({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM scopes')) return Promise.resolve([scope])
        return Promise.resolve([])
      }),
    })

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(deps.perimetresData.value).toContainEqual(scope)
  })

  it('populates stats correctly from GROUP BY result', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('GROUP BY status'))
          return Promise.resolve([
            { status: 'todo', count: 5 },
            { status: 'in_progress', count: 2 },
            { status: 'done', count: 10 },
          ])
        return Promise.resolve([])
      }),
    })

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(deps.stats.value.todo).toBe(5)
    expect(deps.stats.value.in_progress).toBe(2)
    expect(deps.stats.value.done).toBe(10)
  })

  it('sets lastRefresh to a Date after successful refresh', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    expect(deps.lastRefresh.value).toBeNull()

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(deps.lastRefresh.value).toBeInstanceOf(Date)
  })

  it('clears error.value to null before each successful refresh', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps({ error: ref('previous error') })

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(deps.error.value).toBeNull()
  })
})

// ─── error handling ───────────────────────────────────────────────────────────

describe('useTaskRefresh — refresh: error handling (L136-L139)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('sets deps.error when query throws', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps({
      query: vi.fn().mockRejectedValue(new Error('SQLite connection failed')),
    })

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(deps.error.value).toMatch('SQLite connection failed')
  })

  it('calls pushToast with error message when query throws', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps({
      query: vi.fn().mockRejectedValue(new Error('Query timeout')),
    })

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockPushToast).toHaveBeenCalledWith(expect.stringContaining('Query timeout'))
  })
})
