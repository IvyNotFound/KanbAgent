/**
 * Tests for useTaskRefresh composable — watchForDb visibility + dbPath null guard
 * Split from useTaskRefresh.spec.ts (T1282)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { mockElectronAPI, installElectronAPIMock, makeDeps } from './__helpers__/useTaskRefresh.helpers'

installElectronAPIMock()

// ─── Mock stores used by useTaskRefresh ───────────────────────────────────────
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

vi.mock('@renderer/composables/useToast', () => ({
  useToast: () => ({
    push: vi.fn(),
  }),
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useTaskRefresh — watchForDb: document.visibilityState (L169)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true })
  })

  it('skips findProjectDb when document is hidden', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true, configurable: true })

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { watchForDb } = useTaskRefresh(deps)

    watchForDb('/my/project')
    await vi.advanceTimersByTimeAsync(2000)

    expect(mockElectronAPI.findProjectDb).not.toHaveBeenCalled()
  })

  it('calls findProjectDb when document is visible', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true })

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { watchForDb } = useTaskRefresh(deps)

    mockElectronAPI.findProjectDb.mockResolvedValue(null)
    watchForDb('/my/project')
    await vi.advanceTimersByTimeAsync(2000)

    expect(mockElectronAPI.findProjectDb).toHaveBeenCalledWith('/my/project')
  })

  it('skips findProjectDb when document becomes hidden mid-polling', async () => {
    vi.useFakeTimers()

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { watchForDb } = useTaskRefresh(deps)

    mockElectronAPI.findProjectDb.mockResolvedValue(null)
    watchForDb('/my/project')

    // First tick: visible → calls findProjectDb
    await vi.advanceTimersByTimeAsync(2000)
    const firstCallCount = mockElectronAPI.findProjectDb.mock.calls.length
    expect(firstCallCount).toBeGreaterThan(0)

    // Switch to hidden
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true, configurable: true })
    mockElectronAPI.findProjectDb.mockClear()

    // Second tick: hidden → should skip
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockElectronAPI.findProjectDb).not.toHaveBeenCalled()
  })

  it('stops polling once db is found', async () => {
    vi.useFakeTimers()

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { watchForDb } = useTaskRefresh(deps)

    mockElectronAPI.findProjectDb.mockResolvedValueOnce('/my/project/.claude/project.db')
    watchForDb('/my/project')

    await vi.advanceTimersByTimeAsync(2000)
    mockElectronAPI.findProjectDb.mockClear()

    // Advance another interval — should not poll again
    await vi.advanceTimersByTimeAsync(4000)
    expect(mockElectronAPI.findProjectDb).not.toHaveBeenCalled()
  })

  it('clears previous interval when watchForDb called again', async () => {
    vi.useFakeTimers()

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { watchForDb } = useTaskRefresh(deps)

    mockElectronAPI.findProjectDb.mockResolvedValue(null)
    watchForDb('/first')
    watchForDb('/second')

    await vi.advanceTimersByTimeAsync(2000)

    expect(mockElectronAPI.findProjectDb).not.toHaveBeenCalledWith('/first')
    expect(mockElectronAPI.findProjectDb).toHaveBeenCalledWith('/second')
  })
})

describe('useTaskRefresh — refresh: no-op when dbPath is null (L46)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('returns early when dbPath.value is null', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps({ dbPath: ref(null) })
    const { refresh } = useTaskRefresh(deps)

    await refresh()

    expect((deps.query as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    expect(deps.loading.value).toBe(false)
  })
})
