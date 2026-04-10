/**
 * T1338: Mutation coverage for useLaunchSession.ts — TTL cache boundary
 *
 * Targets:
 * - Cache TTL boundary: exactly TTL-1ms, TTL, TTL+1ms (EqualityOperator line 47)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLaunchSession } from './useLaunchSession'
import { useTasksStore } from '@renderer/stores/tasks'
import { api, makeAgent, makeTask, testCounter } from './__helpers__/useLaunchSession-t1338.helpers'

describe('useLaunchSession T1338: TTL cache boundary (EqualityOperator line 47)', () => {
  // These tests verify the exact boundary: `now - cacheTimestamp < CACHE_TTL_MS`
  // Mutations: change < to <=, >=, >, !=, ==
  // We need the SAME module-level cache, so we use a fixed base and advance from there.

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    testCounter.value++
    vi.useFakeTimers()
    // Use large offsets to ensure prior tests' caches are expired
    vi.setSystemTime(new Date(2026, 4, 1, testCounter.value, 0, 0))
    api.getCliInstances.mockResolvedValue([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }
    ])
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true, systemPrompt: 'You are dev-front', systemPromptSuffix: null, thinkingMode: 'auto'
    })
    api.buildAgentPrompt.mockResolvedValue('final prompt')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('TTL-1ms: cache still valid 1ms before expiry — no second IPC call', async () => {
    // Verify: at TTL-1ms, cache IS still valid (now - ts < TTL is true)
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())
    expect(api.getCliInstances).toHaveBeenCalledTimes(1)

    // Advance to exactly TTL - 1ms (still within TTL)
    vi.advanceTimersByTime(5 * 60 * 1000 - 1)
    await launchAgentTerminal(makeAgent(), makeTask())

    // Must still be 1 call — cache is valid at TTL-1ms
    expect(api.getCliInstances).toHaveBeenCalledTimes(1)
  })

  it('TTL exactly: cache expired at exactly TTL ms — triggers second IPC call', async () => {
    // Verify: at exactly TTL ms elapsed, cache IS expired (now - ts < TTL is false when equal)
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())
    expect(api.getCliInstances).toHaveBeenCalledTimes(1)

    // Advance to exactly TTL (= 5 min * 60s * 1000ms)
    vi.advanceTimersByTime(5 * 60 * 1000)
    await launchAgentTerminal(makeAgent(), makeTask())

    // Cache is expired: now - cacheTimestamp == TTL, which is NOT < TTL → second call
    expect(api.getCliInstances).toHaveBeenCalledTimes(2)
  })

  it('TTL+1ms: cache definitely expired — triggers second IPC call', async () => {
    // Verify: at TTL+1ms, cache IS expired (now - ts < TTL is false)
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())
    expect(api.getCliInstances).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    await launchAgentTerminal(makeAgent(), makeTask())

    expect(api.getCliInstances).toHaveBeenCalledTimes(2)
  })

  it('cache with non-empty result: cacheTimestamp is updated, subsequent call within TTL uses cache', async () => {
    // This tests that cacheTimestamp is actually SET (line 53: cacheTimestamp = now)
    // If cacheTimestamp were never updated, every call would go through
    const { launchAgentTerminal } = useLaunchSession()

    // First call at t=0
    await launchAgentTerminal(makeAgent(), makeTask())
    // Second call at t=1000ms (well within TTL)
    vi.advanceTimersByTime(1000)
    await launchAgentTerminal(makeAgent(), makeTask())
    vi.advanceTimersByTime(1000)
    await launchAgentTerminal(makeAgent(), makeTask())

    // Only 1 IPC call total — cache was stored and reused
    expect(api.getCliInstances).toHaveBeenCalledTimes(1)
  })
})
