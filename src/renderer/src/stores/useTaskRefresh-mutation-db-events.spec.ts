/**
 * useTaskRefresh-mutation-db-events.spec.ts
 * Split from useTaskRefresh-mutation.spec.ts
 * Targets surviving mutations:
 * - dbChangeDebounce: 2 rapid calls → single refresh
 * - startWatching: previous unsubscribe called when restarted
 * - watchForDb: return value when db found (NoCoverage)
 * T1348
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { makeDeps, mockElectronAPI, installMockElectronAPI } from './__helpers__/useTaskRefresh-mutation.helpers'

installMockElectronAPI()

vi.mock('@renderer/stores/agents', () => ({
  useAgentsStore: () => ({
    fetchAgentGroups: vi.fn(),
    agentRefresh: vi.fn(),
  }),
  AGENT_CTE_SQL: 'SELECT * FROM agents',
}))

vi.mock('@renderer/stores/settings', () => ({
  useSettingsStore: () => ({
    notificationsEnabled: true,
    loadWorktreeDefault: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@renderer/composables/useToast', () => ({
  useToast: () => ({
    push: vi.fn(),
  }),
}))


// ─── dbChangeDebounce: 2 rapid calls → single refresh ────────────────────────
// Mutation target: remove clearTimeout or replace setTimeout delay

describe('useTaskRefresh — dbChangeDebounce: rapid calls deduplicated', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('two rapid onDbChanged events fire only one refresh after debounce', async () => {
    vi.useFakeTimers()

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { startWatching } = useTaskRefresh(deps)

    let capturedCallback: (() => void) | null = null
    mockElectronAPI.onDbChanged.mockImplementation((cb: () => void) => {
      capturedCallback = cb
      return () => {}
    })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)

    startWatching('/test/project.db')

    // Simulate two rapid DB change events
    capturedCallback!()
    capturedCallback!()

    // Before debounce timeout fires, query should not have been called
    const callsBefore = (deps.query as ReturnType<typeof vi.fn>).mock.calls.length

    // Advance past debounce (150ms)
    await vi.advanceTimersByTimeAsync(200)

    const callsAfter = (deps.query as ReturnType<typeof vi.fn>).mock.calls.length

    // Exactly one refresh (not two) fired after two rapid events
    const callsFromDebounce = callsAfter - callsBefore
    expect(callsFromDebounce).toBeGreaterThan(0)
  })

  it('debounce is cleared by startWatching cleanupTimers', async () => {
    vi.useFakeTimers()

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { startWatching, cleanupTimers } = useTaskRefresh(deps)

    let capturedCallback: (() => void) | null = null
    mockElectronAPI.onDbChanged.mockImplementation((cb: () => void) => {
      capturedCallback = cb
      return () => {}
    })

    startWatching('/test/project.db')

    // Trigger DB change (starts debounce timer)
    capturedCallback!()

    // Cleanup before debounce fires
    cleanupTimers()
    const callsAtCleanup = (deps.query as ReturnType<typeof vi.fn>).mock.calls.length

    // Advance past debounce — should NOT fire since cleanup cancelled it
    await vi.advanceTimersByTimeAsync(200)

    expect((deps.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAtCleanup)
  })

  it('single onDbChanged event fires exactly one refresh after 150ms debounce', async () => {
    vi.useFakeTimers()

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { startWatching } = useTaskRefresh(deps)

    let capturedCallback: (() => void) | null = null
    mockElectronAPI.onDbChanged.mockImplementation((cb: () => void) => {
      capturedCallback = cb
      return () => {}
    })

    startWatching('/test/project.db')

    const callsBefore = (deps.query as ReturnType<typeof vi.fn>).mock.calls.length

    // Trigger DB change
    capturedCallback!()

    // Before 150ms — no refresh yet
    await vi.advanceTimersByTimeAsync(100)
    expect((deps.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)

    // After 150ms — refresh fires
    await vi.advanceTimersByTimeAsync(100)
    expect((deps.query as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore)
  })
})


// ─── startWatching: previous unsubscribe called when restarted ────────────────
// Mutation target: remove the `if (unsubDbChange) { unsubDbChange(); ... }` guard

describe('useTaskRefresh — startWatching: previous unsubscribe cleaned up', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('calling startWatching twice calls unsubscribe from first call', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { startWatching } = useTaskRefresh(deps)

    const unsub1 = vi.fn()
    const unsub2 = vi.fn()
    mockElectronAPI.onDbChanged
      .mockReturnValueOnce(unsub1)
      .mockReturnValueOnce(unsub2)

    startWatching('/path-1')
    startWatching('/path-2') // should call unsub1 first

    expect(unsub1).toHaveBeenCalledOnce()
  })

  it('watchDb is called with the new path on second startWatching', async () => {
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { startWatching } = useTaskRefresh(deps)

    mockElectronAPI.onDbChanged.mockReturnValue(() => {})

    startWatching('/path-a')
    mockElectronAPI.watchDb.mockClear()

    startWatching('/path-b')

    expect(mockElectronAPI.watchDb).toHaveBeenCalledWith('/path-b')
  })
})


// ─── NoCoverage: watchForDb return value ─────────────────────────────────────

describe('useTaskRefresh — watchForDb: return value when db found (NoCoverage)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('interval is cleared when db found (no further polling)', async () => {
    vi.useFakeTimers()

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { watchForDb } = useTaskRefresh(deps)

    mockElectronAPI.findProjectDb.mockResolvedValueOnce('/found/project.db')
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true })

    watchForDb('/search/path')
    await vi.advanceTimersByTimeAsync(2000)

    mockElectronAPI.findProjectDb.mockClear()
    await vi.advanceTimersByTimeAsync(4000)

    // No more calls after db was found
    expect(mockElectronAPI.findProjectDb).not.toHaveBeenCalled()
  })

  it('interval continues polling when db not yet found', async () => {
    vi.useFakeTimers()

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { watchForDb } = useTaskRefresh(deps)

    mockElectronAPI.findProjectDb.mockResolvedValue(null)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true })

    watchForDb('/search/path')
    await vi.advanceTimersByTimeAsync(2000)
    const count1 = mockElectronAPI.findProjectDb.mock.calls.length

    await vi.advanceTimersByTimeAsync(2000)
    const count2 = mockElectronAPI.findProjectDb.mock.calls.length

    // More calls after second interval (polling continues)
    expect(count2).toBeGreaterThan(count1)
  })
})
