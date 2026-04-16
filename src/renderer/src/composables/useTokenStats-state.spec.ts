/**
 * Tests for useTokenStats composable state:
 * activePeriod, costPeriod, selectedPeriod watcher, estimatedCost,
 * avgPerSession, cacheHitRate, cacheHitColor
 */
import { describe, it, expect, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { PERIODS } from '@renderer/composables/useTokenStats'
import { setupComposable } from './__helpers__/useTokenStats.helpers'

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

// ─── Tests: estimatedCost (T1924: sums per-session costs from sessionRows) ───

// Helper to build a minimal SessionTokenRow for cost tests.
// model_used=null + cli_type=null triggers Sonnet 4.6 fallback pricing.
function makeRow(tokens: { in?: number; out?: number; cacheRead?: number; cacheWrite?: number }) {
  return {
    id: 1, agent_id: 1, agent_name: 'test', started_at: '2026-01-01', ended_at: null,
    status: 'completed', cli_type: null, cost_usd: null, model_used: null,
    tokens_in: tokens.in ?? 0, tokens_out: tokens.out ?? 0,
    tokens_cache_read: tokens.cacheRead ?? 0, tokens_cache_write: tokens.cacheWrite ?? 0,
    total: (tokens.in ?? 0) + (tokens.out ?? 0),
  }
}

describe('estimatedCost', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns 0 when sessionRows is empty', async () => {
    const { estimatedCost, sessionRows } = await setupComposable()
    sessionRows.value = []
    expect(estimatedCost.value).toBe(0)
  })

  it('computes cost correctly: 1M tokens_in at $3.00/1M = $3.00', async () => {
    const { estimatedCost, sessionRows } = await setupComposable()
    sessionRows.value = [makeRow({ in: 1_000_000 })]
    expect(estimatedCost.value).toBeCloseTo(3.0, 5)
  })

  it('computes cost correctly: 1M tokens_out at $15.00/1M = $15.00', async () => {
    const { estimatedCost, sessionRows } = await setupComposable()
    sessionRows.value = [makeRow({ out: 1_000_000 })]
    expect(estimatedCost.value).toBeCloseTo(15.0, 5)
  })

  it('computes cost correctly: 1M cache_read at $0.30/1M = $0.30', async () => {
    const { estimatedCost, sessionRows } = await setupComposable()
    sessionRows.value = [makeRow({ cacheRead: 1_000_000 })]
    expect(estimatedCost.value).toBeCloseTo(0.30, 5)
  })

  it('computes cost correctly: 1M cache_write at $3.75/1M = $3.75', async () => {
    const { estimatedCost, sessionRows } = await setupComposable()
    sessionRows.value = [makeRow({ cacheWrite: 1_000_000 })]
    expect(estimatedCost.value).toBeCloseTo(3.75, 5)
  })

  it('sums all 4 pricing terms correctly', async () => {
    const { estimatedCost, sessionRows } = await setupComposable()
    // 1M each: 3.00 + 15.00 + 0.30 + 3.75 = 22.05
    sessionRows.value = [makeRow({ in: 1_000_000, out: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 })]
    expect(estimatedCost.value).toBeCloseTo(22.05, 5)
  })

  it('uses multiplication not division (pricing * tokens / 1M)', async () => {
    const { estimatedCost, sessionRows } = await setupComposable()
    // 500_000 tokens_in => 0.5M * $3 = $1.50
    sessionRows.value = [makeRow({ in: 500_000 })]
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
    // 1 / (2 + 1) * 100 = 33.33...% -> rounds to 33
    globalStats.value = { tokens_in: 2, tokens_out: 0, tokens_cache_read: 1, tokens_cache_write: 0, total: 2, session_count: 1 }
    expect(cacheHitRate.value).toBe(33)
  })
})

// ─── Tests: cacheHitColor ────────────────────────────────────────────────────

describe('cacheHitColor', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('returns #34d399 when cacheHitRate > 50', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // rate = 51%: cache_read=51, tokens_in=49
    globalStats.value = { tokens_in: 49, tokens_out: 0, tokens_cache_read: 51, tokens_cache_write: 0, total: 49, session_count: 1 }
    expect(cacheHitColor.value).toBe('#34d399')
  })

  it('returns #fbbf24 when cacheHitRate === 50 (not > 50)', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // rate = 50%: cache_read=100, tokens_in=100
    globalStats.value = { tokens_in: 100, tokens_out: 0, tokens_cache_read: 100, tokens_cache_write: 0, total: 100, session_count: 1 }
    // 50 is NOT > 50, so checks >= 20: 50 >= 20 -> amber
    expect(cacheHitColor.value).toBe('#fbbf24')
  })

  it('returns #fbbf24 when cacheHitRate >= 20 and <= 50', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // rate = 25%: cache_read=25, tokens_in=75
    globalStats.value = { tokens_in: 75, tokens_out: 0, tokens_cache_read: 25, tokens_cache_write: 0, total: 75, session_count: 1 }
    expect(cacheHitColor.value).toBe('#fbbf24')
  })

  it('returns #fbbf24 when cacheHitRate === 20 (boundary >= 20)', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // rate = 20%: cache_read=1, tokens_in=4 -> 1/5 * 100 = 20
    globalStats.value = { tokens_in: 4, tokens_out: 0, tokens_cache_read: 1, tokens_cache_write: 0, total: 4, session_count: 1 }
    expect(cacheHitColor.value).toBe('#fbbf24')
  })

  it('returns var(--content-faint) when cacheHitRate < 20', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // rate = 0%: all tokens_in, no cache_read
    globalStats.value = { tokens_in: 100, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 100, session_count: 1 }
    expect(cacheHitColor.value).toBe('var(--content-faint)')
  })

  it('returns var(--content-faint) when cacheHitRate === 19 (boundary < 20)', async () => {
    const { cacheHitColor, globalStats } = await setupComposable()
    // Need ~19% -- use values that round to 19: cache_read=19, tokens_in=81 -> 19/100 * 100 = 19
    globalStats.value = { tokens_in: 81, tokens_out: 0, tokens_cache_read: 19, tokens_cache_write: 0, total: 81, session_count: 1 }
    expect(cacheHitColor.value).toBe('var(--content-faint)')
  })
})
