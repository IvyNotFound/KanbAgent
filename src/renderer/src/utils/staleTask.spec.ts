import { describe, it, expect, vi, afterEach } from 'vitest'
import { isStale, staleDuration } from './staleTask'

describe('isStale', () => {
  it('returns false when startedAt is null', () => {
    expect(isStale(null)).toBe(false)
  })

  it('returns false when startedAt is undefined', () => {
    expect(isStale(undefined)).toBe(false)
  })

  it('returns false when task started recently (below threshold)', () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
    expect(isStale(recent, 120)).toBe(false)
  })

  it('returns true when task started longer ago than threshold', () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() // 3 hours ago
    expect(isStale(old, 120)).toBe(true)
  })

  it('returns false for invalid date string', () => {
    expect(isStale('not-a-date')).toBe(false)
  })

  it('uses default threshold of 120 minutes', () => {
    const justOver = new Date(Date.now() - 121 * 60 * 1000).toISOString()
    expect(isStale(justOver)).toBe(true)
    const justUnder = new Date(Date.now() - 119 * 60 * 1000).toISOString()
    expect(isStale(justUnder)).toBe(false)
  })
})

describe('staleDuration', () => {
  it('returns empty string for null', () => {
    expect(staleDuration(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(staleDuration(undefined)).toBe('')
  })

  it('returns minutes only for durations under 1 hour', () => {
    const start = new Date(Date.now() - 45 * 60 * 1000).toISOString()
    expect(staleDuration(start)).toBe('45min')
  })

  it('returns hours and minutes for durations over 1 hour', () => {
    const start = new Date(Date.now() - (2 * 60 + 15) * 60 * 1000).toISOString()
    expect(staleDuration(start)).toBe('2h 15min')
  })

  it('returns empty string for invalid date string', () => {
    expect(staleDuration('not-a-date')).toBe('')
  })

  it('returns empty string for a future date (ms <= 0)', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    expect(staleDuration(future)).toBe('')
  })
})

describe('isStale — boundary', () => {
  it('returns true for any non-null/non-NaN date when thresholdMinutes is 0', () => {
    const anyPast = new Date(Date.now() - 1).toISOString()
    expect(isStale(anyPast, 0)).toBe(true)
  })

  it('returns false at exact boundary (elapsed === threshold)', () => {
    const threshold = 60
    // Exactly at boundary: elapsed == threshold * 60 * 1000, strict > is false
    const exactBoundary = new Date(Date.now() - threshold * 60 * 1000).toISOString()
    expect(isStale(exactBoundary, threshold)).toBe(false)
  })
})

describe('staleDuration — boundary (T1330)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty string when ms === 0 (kills <= → < mutation)', () => {
    // Freeze time so Date.now() === start time → ms = 0
    // With ms <= 0: returns '' (correct)
    // With ms < 0 (mutant): 0 < 0 = false → proceeds to format '0min'
    const fixedNow = 1_700_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
    const startedAt = new Date(fixedNow).toISOString()
    expect(staleDuration(startedAt)).toBe('')
  })

  it('returns "0min" for 1ms elapsed (ms > 0)', () => {
    // Ensure the > 0 path returns a value (not caught by the guard)
    const fixedNow = 1_700_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow + 1)
    const startedAt = new Date(fixedNow).toISOString()
    // 1ms → totalMin=0, hours=0, returns '0min'
    expect(staleDuration(startedAt)).toBe('0min')
  })
})
