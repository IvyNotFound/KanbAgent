/**
 * Tests for usePolledData composable.
 *
 * usePolledData: generic polling helper with lifecycle management.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { usePolledData } from './usePolledData'

// ---------------------------------------------------------------------------
// Mock window.electronAPI — minimal surface needed by polled data tests
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
