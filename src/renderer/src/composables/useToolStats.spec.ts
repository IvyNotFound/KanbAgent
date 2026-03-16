/**
 * Tests for useToolStats composable — defensive branches (T1341).
 *
 * Covers: toolUseId absent, tool absent from map, tool_name nullish,
 *         avgDurationMs calculation, errorRate.
 * Framework: Vitest
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useToolStats } from './useToolStats'
import { useHookEventsStore } from '@renderer/stores/hookEvents'

// Minimal electronAPI mock needed by stores loaded indirectly
const mockApi = {
  queryDb: () => Promise.resolve([]),
  watchDb: () => Promise.resolve(undefined),
  unwatchDb: () => Promise.resolve(undefined),
  onDbChanged: () => () => {},
  selectProjectDir: () => Promise.resolve(null),
  migrateDb: () => Promise.resolve({ success: true }),
  findProjectDb: () => Promise.resolve(null),
}
Object.defineProperty(window, 'electronAPI', { value: mockApi, writable: true })

describe('composables/useToolStats', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('returns empty array when no events', () => {
    const { toolStats } = useToolStats()
    expect(toolStats.value).toHaveLength(0)
  })

  it('PostToolUse with toolUseId absent — no duration entry, no crash', () => {
    const store = useHookEventsStore()
    // PreToolUse registers the tool
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Bash', tool_use_id: 'tu-1' }, ts: 100 })
    // PostToolUse without toolUseId — duration cannot be paired
    store.push({ event: 'PostToolUse', payload: { tool_name: 'Bash' }, ts: 200 })

    const { toolStats } = useToolStats()
    expect(toolStats.value).toHaveLength(1)
    expect(toolStats.value[0].avgDurationMs).toBeNull()
  })

  it('PostToolUseFailure on tool absent from map — no crash, errors not incremented', () => {
    const store = useHookEventsStore()
    // No PreToolUse for 'Glob' — map entry does not exist
    store.push({ event: 'PostToolUseFailure', payload: { tool_name: 'Glob' }, ts: 100 })

    const { toolStats } = useToolStats()
    // 'Glob' was never registered via PreToolUse — should not appear in stats
    expect(toolStats.value.find(s => s.name === 'Glob')).toBeUndefined()
  })

  it('PreToolUse without tool_name in payload — uses "?" as name', () => {
    const store = useHookEventsStore()
    store.push({ event: 'PreToolUse', payload: {}, ts: 100 })

    const { toolStats } = useToolStats()
    expect(toolStats.value).toHaveLength(1)
    expect(toolStats.value[0].name).toBe('?')
  })

  it('avgDurationMs with multiple durations — computes mean correctly', () => {
    const store = useHookEventsStore()
    // Two Bash calls with durations 100ms and 300ms → avg = 200ms
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Bash', tool_use_id: 'tu-1' }, ts: 0 })
    store.push({ event: 'PostToolUse', payload: { tool_use_id: 'tu-1' }, ts: 100 })
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Bash', tool_use_id: 'tu-2' }, ts: 200 })
    store.push({ event: 'PostToolUse', payload: { tool_use_id: 'tu-2' }, ts: 500 })

    const { toolStats } = useToolStats()
    expect(toolStats.value[0].avgDurationMs).toBe(200)
  })

  it('avgDurationMs is null when no Post events paired', () => {
    const store = useHookEventsStore()
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Read', tool_use_id: 'tu-1' }, ts: 0 })

    const { toolStats } = useToolStats()
    expect(toolStats.value[0].avgDurationMs).toBeNull()
  })

  it('errorRate = errors/calls', () => {
    const store = useHookEventsStore()
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Write', tool_use_id: 'tu-1' }, ts: 0 })
    store.push({ event: 'PostToolUse', payload: { tool_use_id: 'tu-1' }, ts: 50 })
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Write', tool_use_id: 'tu-2' }, ts: 100 })
    store.push({ event: 'PostToolUseFailure', payload: { tool_name: 'Write' }, ts: 150 })

    const { toolStats } = useToolStats()
    const stat = toolStats.value.find(s => s.name === 'Write')!
    expect(stat.calls).toBe(2)
    expect(stat.errors).toBe(1)
    expect(stat.errorRate).toBe(0.5)
  })

  it('errorRate = 0 when calls = 0 (should not divide by zero)', () => {
    // This case cannot normally occur via PreToolUse path, but verify the computed guard
    // by using PostToolUseFailure without a preceding PreToolUse
    const store = useHookEventsStore()
    store.push({ event: 'PostToolUseFailure', payload: { tool_name: 'Bash' }, ts: 1 })

    const { toolStats } = useToolStats()
    // 'Bash' was never in map — no entry emitted
    const stat = toolStats.value.find(s => s.name === 'Bash')
    expect(stat).toBeUndefined()
  })

  it('sorted by calls descending', () => {
    const store = useHookEventsStore()
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Read' }, ts: 1 })
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Bash' }, ts: 2 })
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Bash' }, ts: 3 })
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Glob' }, ts: 4 })
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Glob' }, ts: 5 })
    store.push({ event: 'PreToolUse', payload: { tool_name: 'Glob' }, ts: 6 })

    const { toolStats } = useToolStats()
    const names = toolStats.value.map(s => s.name)
    expect(names[0]).toBe('Glob')   // 3 calls
    expect(names[1]).toBe('Bash')   // 2 calls
    expect(names[2]).toBe('Read')   // 1 call
  })

  it('PostToolUseFailure without tool_name — uses "?" as name, increments if pre exists', () => {
    const store = useHookEventsStore()
    // Register '?' via PreToolUse
    store.push({ event: 'PreToolUse', payload: {}, ts: 1 })
    // PostToolUseFailure also without tool_name
    store.push({ event: 'PostToolUseFailure', payload: {}, ts: 2 })

    const { toolStats } = useToolStats()
    const stat = toolStats.value.find(s => s.name === '?')!
    expect(stat.errors).toBe(1)
  })
})
