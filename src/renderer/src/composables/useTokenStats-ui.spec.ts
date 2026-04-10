/**
 * Tests for useTokenStats composable UI helpers:
 * maxAgentTotal, barWidth, sparkBarHeight, sparkMax, sparkBars,
 * agentStyles, whereClause, andOrWhere, fetchStats error handling
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { setupComposable } from './__helpers__/useTokenStats.helpers'

// ─── Tests: maxAgentTotal + barWidth ─────────────────────────────────────────

describe('maxAgentTotal and barWidth', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('maxAgentTotal is 1 when agentRows is empty (default)', async () => {
    const { maxAgentTotal } = await setupComposable()
    expect(maxAgentTotal.value).toBe(1)
  })

  it('maxAgentTotal equals the highest total in agentRows', async () => {
    const { maxAgentTotal, agentRows } = await setupComposable()
    agentRows.value = [
      { agent_id: 1, agent_name: 'a', tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 500, session_count: 1 },
      { agent_id: 2, agent_name: 'b', tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 1000, session_count: 2 },
    ]
    await nextTick()
    expect(maxAgentTotal.value).toBe(1000)
  })

  it('barWidth returns percentage string proportional to maxAgentTotal', async () => {
    const { barWidth, agentRows } = await setupComposable()
    agentRows.value = [
      { agent_id: 1, agent_name: 'a', tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 1000, session_count: 1 },
    ]
    await nextTick()
    // 1000 / 1000 * 100 = 100%, max(100, 2) = 100
    expect(barWidth(1000)).toBe('100%')
  })

  it('barWidth enforces minimum of 2%', async () => {
    const { barWidth, agentRows } = await setupComposable()
    agentRows.value = [
      { agent_id: 1, agent_name: 'a', tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 1_000_000, session_count: 1 },
    ]
    await nextTick()
    // 0 / 1_000_000 * 100 = 0 -> max(0, 2) = 2
    expect(barWidth(0)).toBe('2%')
  })

  it('barWidth with total=0 on empty agentRows uses maxAgentTotal=1', async () => {
    const { barWidth } = await setupComposable()
    // maxAgentTotal=1, total=0 => 0/1*100=0% => 2% minimum
    expect(barWidth(0)).toBe('2%')
  })
})

// ─── Tests: sparkBarHeight ────────────────────────────────────────────────────

describe('sparkBarHeight', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns 0 when total is 0', async () => {
    const { sparkBarHeight } = await setupComposable()
    expect(sparkBarHeight(0)).toBe(0)
  })

  it('returns Math.max(Math.round(total / sparkMax * 44), 2) for non-zero total', async () => {
    const { sparkBarHeight, sparkDays } = await setupComposable()
    // Use a date within the last 30 days to affect sparkMax
    const recentDate = new Date()
    recentDate.setUTCDate(recentDate.getUTCDate() - 1)
    const key = recentDate.toISOString().slice(0, 10)
    sparkDays.value = [{ day: key, total: 100 }]
    await nextTick()
    // total=50 on sparkMax=100 => 50/100*44 = 22 => max(22, 2) = 22
    expect(sparkBarHeight(50)).toBe(22)
  })

  it('enforces minimum of 2 for small non-zero totals', async () => {
    const { sparkBarHeight, sparkDays } = await setupComposable()
    const recentDate = new Date()
    recentDate.setUTCDate(recentDate.getUTCDate() - 1)
    const key = recentDate.toISOString().slice(0, 10)
    sparkDays.value = [{ day: key, total: 1_000_000 }]
    await nextTick()
    // 1 / 1_000_000 * 44 = 0.000044 => Math.round = 0 => max(0, 2) = 2
    expect(sparkBarHeight(1)).toBe(2)
  })

  it('returns 44 for max value (sparkMax itself)', async () => {
    const { sparkBarHeight, sparkDays } = await setupComposable()
    const recentDate = new Date()
    recentDate.setUTCDate(recentDate.getUTCDate() - 1)
    const key = recentDate.toISOString().slice(0, 10)
    sparkDays.value = [{ day: key, total: 100 }]
    await nextTick()
    // 100/100*44 = 44 => max(44, 2) = 44
    expect(sparkBarHeight(100)).toBe(44)
  })
})

// ─── Tests: sparkMax ─────────────────────────────────────────────────────────

describe('sparkMax', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('sparkMax is at least 1 (default when no sparkDays)', async () => {
    const { sparkMax } = await setupComposable()
    expect(sparkMax.value).toBeGreaterThanOrEqual(1)
  })
})

// ─── Tests: sparkBars structure ──────────────────────────────────────────────

describe('sparkBars', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('generates 30 bars for 30 days', async () => {
    const { sparkBars } = await setupComposable()
    await nextTick()
    expect(sparkBars.value).toHaveLength(30)
  })

  it('bars have day, total, and label properties', async () => {
    const { sparkBars } = await setupComposable()
    await nextTick()
    const bar = sparkBars.value[0]
    expect(bar).toHaveProperty('day')
    expect(bar).toHaveProperty('total')
    expect(bar).toHaveProperty('label')
  })

  it('bar total is 0 for days not in sparkDays', async () => {
    const { sparkBars } = await setupComposable()
    await nextTick()
    // All bars are 0 since sparkDays is empty
    expect(sparkBars.value.every(b => b.total === 0)).toBe(true)
  })

  it('bar total is populated from sparkDays data', async () => {
    const { sparkBars, sparkDays } = await setupComposable()
    // Use yesterday (within the 30-day window)
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const key = yesterday.toISOString().slice(0, 10)
    sparkDays.value = [{ day: key, total: 999 }]
    await nextTick()
    const bar = sparkBars.value.find(b => b.day === key)
    expect(bar?.total).toBe(999)
  })

  it('bars are ordered oldest to newest (first bar is 29 days ago)', async () => {
    const { sparkBars } = await setupComposable()
    await nextTick()
    // Check bars are in ascending date order
    for (let i = 0; i < sparkBars.value.length - 1; i++) {
      expect(sparkBars.value[i].day <= sparkBars.value[i + 1].day).toBe(true)
    }
  })
})

// ─── Tests: agentStyles ──────────────────────────────────────────────────────

describe('agentStyles', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns empty map when no agent/session rows', async () => {
    const { agentStyles } = await setupComposable()
    expect(agentStyles.value.size).toBe(0)
  })

  it('builds style for each unique agent_name in agentRows', async () => {
    const { agentStyles, agentRows } = await setupComposable()
    agentRows.value = [
      { agent_id: 1, agent_name: 'dev-front', tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 100, session_count: 1 },
    ]
    await nextTick()
    const style = agentStyles.value.get('dev-front')
    expect(style).toBeDefined()
    expect(style?.color).toBe('fg-dev-front')
    expect(style?.backgroundColor).toBe('bg-dev-front')
    expect(style?.boxShadow).toBe('0 0 0 1px border-dev-front')
  })

  it('deduplicates: same agent_name in agentRows and sessionRows produces one entry', async () => {
    const { agentStyles, agentRows, sessionRows } = await setupComposable()
    agentRows.value = [
      { agent_id: 1, agent_name: 'dev-front', tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 100, session_count: 1 },
    ]
    sessionRows.value = [
      { id: 1, agent_id: 1, agent_name: 'dev-front', started_at: '2026-01-01T00:00:00Z', ended_at: null, status: 'active', tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 50 },
    ]
    await nextTick()
    expect(agentStyles.value.size).toBe(1)
  })

  it('skips rows where agent_name is null', async () => {
    const { agentStyles, agentRows } = await setupComposable()
    agentRows.value = [
      { agent_id: 1, agent_name: null, tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 100, session_count: 1 },
    ]
    await nextTick()
    expect(agentStyles.value.size).toBe(0)
  })

  it('includes multiple distinct agents', async () => {
    const { agentStyles, agentRows } = await setupComposable()
    agentRows.value = [
      { agent_id: 1, agent_name: 'agent-a', tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 100, session_count: 1 },
      { agent_id: 2, agent_name: 'agent-b', tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 200, session_count: 2 },
    ]
    await nextTick()
    expect(agentStyles.value.size).toBe(2)
    expect(agentStyles.value.has('agent-a')).toBe(true)
    expect(agentStyles.value.has('agent-b')).toBe(true)
  })
})

// ─── Tests: whereClause and andOrWhere (T1344) ────────────────────────────────

describe('whereClause', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('"all" period sends SQL with no WHERE clause for main query', async () => {
    const mockQueryDb = vi.fn().mockResolvedValue([])
    ;(window.electronAPI as Record<string, unknown>).queryDb = mockQueryDb

    await setupComposable({ localStoragePeriod: 'all', dbPath: '/test/db' })
    await new Promise(resolve => setTimeout(resolve, 0))

    const calls = mockQueryDb.mock.calls as [string, string][]
    const globalQuery = calls[0]?.[1] ?? ''
    expect(globalQuery).not.toContain('WHERE started_at >=')
  })

  it('"24h" period includes WHERE started_at >= in SQL', async () => {
    const mockQueryDb = vi.fn().mockResolvedValue([])
    ;(window.electronAPI as Record<string, unknown>).queryDb = mockQueryDb

    // Start with 'all' so the watch fires when we switch to '24h'
    const { selectedPeriod } = await setupComposable({ localStoragePeriod: 'all', dbPath: '/test/db' })
    selectedPeriod.value = '24h'
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    const calls = mockQueryDb.mock.calls as [string, string][]
    const globalQuery = calls[0]?.[1] ?? ''
    expect(globalQuery).toContain('WHERE started_at >=')
  })
})

// ─── Tests: andOrWhere (T1344) ────────────────────────────────────────────────

describe('andOrWhere', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('"all" period uses plain WHERE for session filter (no started_at)', async () => {
    const mockQueryDb = vi.fn().mockResolvedValue([])
    ;(window.electronAPI as Record<string, unknown>).queryDb = mockQueryDb

    // Start with '24h' so the watch fires when we switch to 'all'
    const { selectedPeriod } = await setupComposable({ localStoragePeriod: '24h', dbPath: '/test/db' })
    selectedPeriod.value = 'all'
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    const calls = mockQueryDb.mock.calls as [string, string][]
    const sessionQuery = calls[2]?.[1] ?? ''
    expect(sessionQuery).not.toContain('started_at >=')
    expect(sessionQuery).toContain('WHERE')
  })

  it('"7d" period uses WHERE started_at >= ... AND ... for session filter', async () => {
    const mockQueryDb = vi.fn().mockResolvedValue([])
    ;(window.electronAPI as Record<string, unknown>).queryDb = mockQueryDb

    // Start with 'all' so the watch fires when we switch to '7d'
    const { selectedPeriod } = await setupComposable({ localStoragePeriod: 'all', dbPath: '/test/db' })
    selectedPeriod.value = '7d'
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    const calls = mockQueryDb.mock.calls as [string, string][]
    const sessionQuery = calls[2]?.[1] ?? ''
    expect(sessionQuery).toContain('WHERE started_at >=')
    expect(sessionQuery).toContain(' AND ')
  })
})

// ─── Tests: fetchStats error handling (T1344) ─────────────────────────────────

describe('fetchStats error handling', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('does not throw when queryDb rejects -- globalStats stays at default', async () => {
    const mockQueryDb = vi.fn().mockRejectedValue(new Error('db error'))
    ;(window.electronAPI as Record<string, unknown>).queryDb = mockQueryDb

    const result = await setupComposable({ dbPath: '/test/db' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(result.globalStats.value.total).toBe(0)
  })

  it('skips fetch when dbPath is falsy', async () => {
    const mockQueryDb = vi.fn().mockResolvedValue([])
    ;(window.electronAPI as Record<string, unknown>).queryDb = mockQueryDb

    await setupComposable({ dbPath: '' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mockQueryDb).not.toHaveBeenCalled()
  })
})
