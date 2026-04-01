/**
 * Tests for useTokenStats composable (T1310)
 * Targets: formatNumber, formatCost, loadSavedPeriod/activePeriod,
 * costPeriod, estimatedCost, cacheHitRate/cacheHitColor, barWidth,
 * sparkBarHeight, sparkBars, agentStyles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key,
      locale: { value: 'en' },
    }),
  }
})

vi.mock('@renderer/composables/usePolledData', () => ({
  usePolledData: () => ({ loading: { value: false }, refresh: vi.fn() }),
}))

vi.mock('@renderer/utils/agentColor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/utils/agentColor')>()
  return {
    ...actual,
    agentFg: (name: string) => `fg-${name}`,
    agentBg: (name: string) => `bg-${name}`,
    agentBorder: (name: string) => `border-${name}`,
  }
})

// ─── Tests: formatNumber ───────────────────────────────────────────────────────

import { formatNumber, formatCost, PERIODS, estimateSessionCost } from '@renderer/composables/useTokenStats'
import type { SessionTokenRow } from '@renderer/composables/useTokenStats'

describe('formatNumber', () => {
  it('formats >= 1_000_000 as M with 1 decimal', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M')
    expect(formatNumber(1_500_000)).toBe('1.5M')
    expect(formatNumber(2_000_000)).toBe('2.0M')
  })

  it('formats exactly 1_000_000 as M (boundary >= 1_000_000)', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M')
  })

  it('formats 999_999 as k (below 1M threshold)', () => {
    expect(formatNumber(999_999)).toBe('1000.0k')
  })

  it('formats >= 1_000 as k with 1 decimal', () => {
    expect(formatNumber(1_000)).toBe('1.0k')
    expect(formatNumber(2_500)).toBe('2.5k')
    expect(formatNumber(10_000)).toBe('10.0k')
  })

  it('formats exactly 1_000 as k (boundary >= 1_000)', () => {
    expect(formatNumber(1_000)).toBe('1.0k')
  })

  it('formats 999 as plain number (below 1k threshold)', () => {
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(500)).toBe('500')
  })

  it('formats 0 as plain number', () => {
    expect(formatNumber(0)).toBe('0')
  })
})

// ─── Tests: formatCost ────────────────────────────────────────────────────────

describe('formatCost', () => {
  it('returns "< $0.01" when usd < 0.01', () => {
    expect(formatCost(0)).toBe('< $0.01')
    expect(formatCost(0.005)).toBe('< $0.01')
    expect(formatCost(0.009)).toBe('< $0.01')
  })

  it('formats exactly 0.01 as "$0.01" (boundary: >= 0.01)', () => {
    expect(formatCost(0.01)).toBe('$0.01')
  })

  it('formats values >= 0.01 with 2 decimal places', () => {
    expect(formatCost(0.5)).toBe('$0.50')
    expect(formatCost(1.5)).toBe('$1.50')
    expect(formatCost(10.0)).toBe('$10.00')
  })

  it('formats large values correctly', () => {
    expect(formatCost(100.999)).toBe('$101.00')
  })
})

// ─── Tests: PERIODS constant ───────────────────────────────────────────────────

describe('PERIODS', () => {
  it('has 5 periods with expected keys', () => {
    const keys = PERIODS.map(p => p.key)
    expect(keys).toEqual(['1h', '24h', '7d', '30d', 'all'])
  })

  it('PERIODS[1] is the 24h period (default fallback)', () => {
    expect(PERIODS[1].key).toBe('24h')
  })
})

// ─── Tests: composable with store setup ──────────────────────────────────────

async function setupComposable(opts: {
  dbPath?: string
  activeTabId?: string
  localStoragePeriod?: string | null
} = {}) {
  vi.resetModules()
  setActivePinia(createPinia())
  localStorage.clear()

  if (opts.localStoragePeriod !== undefined) {
    if (opts.localStoragePeriod !== null) {
      localStorage.setItem('tokenStats.period', opts.localStoragePeriod)
    }
  }

  const { useTasksStore } = await import('@renderer/stores/tasks')
  const { useTabsStore } = await import('@renderer/stores/tabs')

  const tasksStore = useTasksStore()
  tasksStore.$patch({ dbPath: opts.dbPath ?? '/test/db' })

  const tabsStore = useTabsStore()
  tabsStore.$patch({ activeTabId: opts.activeTabId ?? 'dashboard' })

  const { useTokenStats } = await import('@renderer/composables/useTokenStats')
  return useTokenStats()
}

// ─── Tests: activePeriod / loadSavedPeriod ────────────────────────────────────

describe('activePeriod — loadSavedPeriod', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('defaults to 24h when localStorage has no value', async () => {
    const { activePeriod } = await setupComposable({ localStoragePeriod: null })
    expect(activePeriod.value.key).toBe('24h')
  })

  it('loads valid period from localStorage', async () => {
    const { activePeriod } = await setupComposable({ localStoragePeriod: '7d' })
    expect(activePeriod.value.key).toBe('7d')
  })

  it('loads "1h" period from localStorage', async () => {
    const { activePeriod } = await setupComposable({ localStoragePeriod: '1h' })
    expect(activePeriod.value.key).toBe('1h')
  })

  it('loads "all" period from localStorage', async () => {
    const { activePeriod } = await setupComposable({ localStoragePeriod: 'all' })
    expect(activePeriod.value.key).toBe('all')
  })

  it('falls back to PERIODS[1] (24h) when localStorage has invalid value', async () => {
    const { activePeriod } = await setupComposable({ localStoragePeriod: 'invalid_period' })
    expect(activePeriod.value.key).toBe('24h')
  })

  it('falls back to PERIODS[1] (24h) when localStorage has empty string', async () => {
    const { activePeriod } = await setupComposable({ localStoragePeriod: '' })
    expect(activePeriod.value.key).toBe('24h')
  })

  it('activePeriod matches the actual PERIODS object for the loaded key', async () => {
    const { activePeriod } = await setupComposable({ localStoragePeriod: '30d' })
    const expected = PERIODS.find(p => p.key === '30d')
    expect(activePeriod.value).toEqual(expected)
  })
})

// ─── Tests: costPeriod ────────────────────────────────────────────────────────

describe('costPeriod', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns "day" for period "1h"', async () => {
    const { costPeriod } = await setupComposable({ localStoragePeriod: '1h' })
    expect(costPeriod.value).toBe('day')
  })

  it('returns "day" for period "24h"', async () => {
    const { costPeriod } = await setupComposable({ localStoragePeriod: '24h' })
    expect(costPeriod.value).toBe('day')
  })

  it('returns "week" for period "7d"', async () => {
    const { costPeriod } = await setupComposable({ localStoragePeriod: '7d' })
    expect(costPeriod.value).toBe('week')
  })

  it('returns "month" for period "30d"', async () => {
    const { costPeriod } = await setupComposable({ localStoragePeriod: '30d' })
    expect(costPeriod.value).toBe('month')
  })

  it('returns "month" for period "all"', async () => {
    const { costPeriod } = await setupComposable({ localStoragePeriod: 'all' })
    expect(costPeriod.value).toBe('month')
  })
})

// ─── Tests: selectedPeriod watcher (saves to localStorage) ───────────────────

describe('selectedPeriod watcher', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('saves period to localStorage when selectedPeriod changes', async () => {
    const { selectedPeriod } = await setupComposable({ localStoragePeriod: '24h' })
    selectedPeriod.value = '7d'
    await nextTick()
    expect(localStorage.getItem('tokenStats.period')).toBe('7d')
  })

  it('updates activePeriod when selectedPeriod changes', async () => {
    const { selectedPeriod, activePeriod } = await setupComposable({ localStoragePeriod: '24h' })
    expect(activePeriod.value.key).toBe('24h')
    selectedPeriod.value = '1h'
    await nextTick()
    expect(activePeriod.value.key).toBe('1h')
  })
})

// ─── Tests: estimatedCost (computeCost) ───────────────────────────────────────

describe('estimatedCost', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns 0 when all token counts are 0', async () => {
    const { estimatedCost, globalStats } = await setupComposable()
    globalStats.value = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 0, session_count: 0 }
    expect(estimatedCost.value).toBe(0)
  })

  it('computes cost correctly: 1M tokens_in at $3.00/1M = $3.00', async () => {
    const { estimatedCost, globalStats } = await setupComposable()
    globalStats.value = { tokens_in: 1_000_000, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 1_000_000, session_count: 1 }
    expect(estimatedCost.value).toBeCloseTo(3.0, 5)
  })

  it('computes cost correctly: 1M tokens_out at $15.00/1M = $15.00', async () => {
    const { estimatedCost, globalStats } = await setupComposable()
    globalStats.value = { tokens_in: 0, tokens_out: 1_000_000, tokens_cache_read: 0, tokens_cache_write: 0, total: 1_000_000, session_count: 1 }
    expect(estimatedCost.value).toBeCloseTo(15.0, 5)
  })

  it('computes cost correctly: 1M cache_read at $0.30/1M = $0.30', async () => {
    const { estimatedCost, globalStats } = await setupComposable()
    globalStats.value = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 1_000_000, tokens_cache_write: 0, total: 0, session_count: 1 }
    expect(estimatedCost.value).toBeCloseTo(0.30, 5)
  })

  it('computes cost correctly: 1M cache_write at $3.75/1M = $3.75', async () => {
    const { estimatedCost, globalStats } = await setupComposable()
    globalStats.value = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 1_000_000, total: 0, session_count: 1 }
    expect(estimatedCost.value).toBeCloseTo(3.75, 5)
  })

  it('sums all 4 pricing terms correctly', async () => {
    const { estimatedCost, globalStats } = await setupComposable()
    // 1M each: 3.00 + 15.00 + 0.30 + 3.75 = 22.05
    globalStats.value = {
      tokens_in: 1_000_000,
      tokens_out: 1_000_000,
      tokens_cache_read: 1_000_000,
      tokens_cache_write: 1_000_000,
      total: 2_000_000,
      session_count: 4,
    }
    expect(estimatedCost.value).toBeCloseTo(22.05, 5)
  })

  it('uses multiplication not division (pricing * tokens / 1M)', async () => {
    const { estimatedCost, globalStats } = await setupComposable()
    // 500_000 tokens_in => 0.5M * $3 = $1.50
    globalStats.value = { tokens_in: 500_000, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 500_000, session_count: 1 }
    expect(estimatedCost.value).toBeCloseTo(1.5, 5)
  })
})

// ─── Tests: avgPerSession ────────────────────────────────────────────────────

describe('avgPerSession', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns 0 when session_count is 0', async () => {
    const { avgPerSession, globalStats } = await setupComposable()
    globalStats.value = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 1000, session_count: 0 }
    expect(avgPerSession.value).toBe(0)
  })

  it('returns Math.round(total / session_count)', async () => {
    const { avgPerSession, globalStats } = await setupComposable()
    globalStats.value = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 1000, session_count: 3 }
    expect(avgPerSession.value).toBe(Math.round(1000 / 3))
  })

  it('returns exact value when divisible', async () => {
    const { avgPerSession, globalStats } = await setupComposable()
    globalStats.value = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 3000, session_count: 3 }
    expect(avgPerSession.value).toBe(1000)
  })
})

// ─── Tests: cacheHitRate ─────────────────────────────────────────────────────

describe('cacheHitRate', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns 0 when total is 0 (guard against division by zero)', async () => {
    const { cacheHitRate, globalStats } = await setupComposable()
    globalStats.value = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 0, session_count: 0 }
    expect(cacheHitRate.value).toBe(0)
  })

  it('computes cache hit rate as percentage: cache_read / (tokens_in + cache_read) * 100', async () => {
    const { cacheHitRate, globalStats } = await setupComposable()
    globalStats.value = { tokens_in: 100, tokens_out: 0, tokens_cache_read: 100, tokens_cache_write: 0, total: 100, session_count: 1 }
    // cache_read=100, total=200 => 50%
    expect(cacheHitRate.value).toBe(50)
  })

  it('returns 100 when all tokens are cache hits', async () => {
    const { cacheHitRate, globalStats } = await setupComposable()
    globalStats.value = { tokens_in: 0, tokens_out: 0, tokens_cache_read: 500, tokens_cache_write: 0, total: 0, session_count: 1 }
    expect(cacheHitRate.value).toBe(100)
  })

  it('rounds the result', async () => {
    const { cacheHitRate, globalStats } = await setupComposable()
    // 1 / (2 + 1) * 100 = 33.33...% → rounds to 33
    globalStats.value = { tokens_in: 2, tokens_out: 0, tokens_cache_read: 1, tokens_cache_write: 0, total: 2, session_count: 1 }
    expect(cacheHitRate.value).toBe(33)
  })
})

// ─── Tests: cacheHitColor ────────────────────────────────────────────────────

describe('cacheHitColor', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns emerald color when cacheHitRate > 50', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // rate = 51%: cache_read=51, tokens_in=49
    globalStats.value = { tokens_in: 49, tokens_out: 0, tokens_cache_read: 51, tokens_cache_write: 0, total: 49, session_count: 1 }
    expect(cacheHitColor.value).toContain('emerald')
  })

  it('returns faint color when cacheHitRate === 50 (not > 50)', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // rate = 50%: cache_read=100, tokens_in=100
    globalStats.value = { tokens_in: 100, tokens_out: 0, tokens_cache_read: 100, tokens_cache_write: 0, total: 100, session_count: 1 }
    // 50 is NOT > 50, so checks >= 20: 50 >= 20 → amber
    expect(cacheHitColor.value).toContain('amber')
  })

  it('returns amber color when cacheHitRate >= 20 and <= 50', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // rate = 25%: cache_read=25, tokens_in=75
    globalStats.value = { tokens_in: 75, tokens_out: 0, tokens_cache_read: 25, tokens_cache_write: 0, total: 75, session_count: 1 }
    expect(cacheHitColor.value).toContain('amber')
  })

  it('returns amber when cacheHitRate === 20 (boundary >= 20)', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // rate = 20%: cache_read=1, tokens_in=4 → 1/5 * 100 = 20
    globalStats.value = { tokens_in: 4, tokens_out: 0, tokens_cache_read: 1, tokens_cache_write: 0, total: 4, session_count: 1 }
    expect(cacheHitColor.value).toContain('amber')
  })

  it('returns faint color when cacheHitRate < 20', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // rate = 0%: all tokens_in, no cache_read
    globalStats.value = { tokens_in: 100, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 100, session_count: 1 }
    expect(cacheHitColor.value).toContain('faint')
  })

  it('returns faint color when cacheHitRate === 19 (boundary < 20)', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // Need ~19% — use values that round to 19: cache_read=19, tokens_in=81 → 19/100 * 100 = 19
    globalStats.value = { tokens_in: 81, tokens_out: 0, tokens_cache_read: 19, tokens_cache_write: 0, total: 81, session_count: 1 }
    expect(cacheHitColor.value).toContain('faint')
  })
})

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
    // 0 / 1_000_000 * 100 = 0 → max(0, 2) = 2
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

  it('does not throw when queryDb rejects — globalStats stays at default', async () => {
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

// ─── Tests: estimateSessionCost (T1366) ──────────────────────────────────────

function makeRow(overrides: Partial<SessionTokenRow> = {}): SessionTokenRow {
  return {
    id: 1, agent_id: 1, agent_name: 'dev-front',
    started_at: '2026-01-01T10:00:00Z', ended_at: null, status: 'completed',
    cli_type: null, cost_usd: null,
    tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0,
    total: 0,
    ...overrides,
  }
}

describe('estimateSessionCost', () => {
  it('returns cost_usd directly when it is set (any CLI)', () => {
    expect(estimateSessionCost(makeRow({ cost_usd: 0.042, cli_type: 'gemini' }))).toBeCloseTo(0.042)
    expect(estimateSessionCost(makeRow({ cost_usd: 0.001, cli_type: 'claude' }))).toBeCloseTo(0.001)
    expect(estimateSessionCost(makeRow({ cost_usd: 0.0, cli_type: null }))).toBeCloseTo(0.0)
  })

  it('uses Anthropic pricing for cli_type="claude"', () => {
    // 1M tokens_in at $3/M = $3.00
    const row = makeRow({ cli_type: 'claude', tokens_in: 1_000_000 })
    expect(estimateSessionCost(row)).toBeCloseTo(3.0, 5)
  })

  it('uses Anthropic pricing for cli_type=null (legacy sessions)', () => {
    // 1M tokens_out at $15/M = $15.00
    const row = makeRow({ cli_type: null, tokens_out: 1_000_000 })
    expect(estimateSessionCost(row)).toBeCloseTo(15.0, 5)
  })

  it('computes all 4 pricing terms for Claude', () => {
    // 1M each: $3 + $15 + $0.30 + $3.75 = $22.05
    const row = makeRow({
      cli_type: 'claude',
      tokens_in: 1_000_000, tokens_out: 1_000_000,
      tokens_cache_read: 1_000_000, tokens_cache_write: 1_000_000,
    })
    expect(estimateSessionCost(row)).toBeCloseTo(22.05, 5)
  })

  it('returns null for gemini without cost_usd', () => {
    expect(estimateSessionCost(makeRow({ cli_type: 'gemini', cost_usd: null }))).toBeNull()
  })

  it('returns null for opencode without cost_usd', () => {
    expect(estimateSessionCost(makeRow({ cli_type: 'opencode', cost_usd: null }))).toBeNull()
  })

  it('returns null for aider without cost_usd', () => {
    expect(estimateSessionCost(makeRow({ cli_type: 'aider', cost_usd: null }))).toBeNull()
  })

  it('returns null for codex without cost_usd', () => {
    expect(estimateSessionCost(makeRow({ cli_type: 'codex', cost_usd: null }))).toBeNull()
  })

  it('cost_usd takes priority over Anthropic pricing for Claude', () => {
    // cost_usd=0.5 should override calculated pricing
    const row = makeRow({ cli_type: 'claude', cost_usd: 0.5, tokens_in: 1_000_000 })
    expect(estimateSessionCost(row)).toBeCloseTo(0.5, 5)
  })

  it('cost_usd=0 is treated as a valid cost (not null)', () => {
    const row = makeRow({ cli_type: 'gemini', cost_usd: 0 })
    expect(estimateSessionCost(row)).toBeCloseTo(0.0, 5)
    expect(estimateSessionCost(row)).not.toBeNull()
  })
})
