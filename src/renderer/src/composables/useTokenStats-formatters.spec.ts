/**
 * Tests for useTokenStats pure functions: formatNumber, formatCost, PERIODS, estimateSessionCost
 */
import { describe, it, expect } from 'vitest'
import { formatNumber, formatCost, PERIODS, estimateSessionCost } from '@renderer/composables/useTokenStats'
import type { SessionTokenRow } from '@renderer/composables/useTokenStats'

// ─── Tests: formatNumber ───────────────────────────────────────────────────────

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
