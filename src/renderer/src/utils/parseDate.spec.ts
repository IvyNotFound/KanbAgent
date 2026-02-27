import { describe, it, expect } from 'vitest'
import { parseUtcDate } from './parseDate'

describe('parseUtcDate', () => {
  it('parses a SQLite CURRENT_TIMESTAMP string as UTC', () => {
    // SQLite "2026-02-27 01:16:29" must be treated as UTC, not local
    const d = parseUtcDate('2026-02-27 01:16:29')
    expect(d.getUTCFullYear()).toBe(2026)
    expect(d.getUTCMonth()).toBe(1) // 0-indexed
    expect(d.getUTCDate()).toBe(27)
    expect(d.getUTCHours()).toBe(1)
    expect(d.getUTCMinutes()).toBe(16)
    expect(d.getUTCSeconds()).toBe(29)
  })

  it('produces the same UTC time regardless of local timezone (T624 regression)', () => {
    // The key invariant: getTime() must equal the equivalent UTC epoch
    const d = parseUtcDate('2026-02-27 02:00:00')
    const expected = Date.UTC(2026, 1, 27, 2, 0, 0)
    expect(d.getTime()).toBe(expected)
  })

  it('passes through ISO 8601 strings that already have T', () => {
    const d = parseUtcDate('2026-02-27T01:16:29Z')
    expect(d.getUTCHours()).toBe(1)
    expect(d.getUTCMinutes()).toBe(16)
  })

  it('passes through strings that already end with Z', () => {
    const d = parseUtcDate('2026-01-15T10:30:00Z')
    expect(d.getUTCHours()).toBe(10)
    expect(d.getUTCMinutes()).toBe(30)
  })

  it('passes through strings with explicit timezone offset', () => {
    const d = parseUtcDate('2026-02-27T01:16:29+01:00')
    // +01:00 → UTC hour is 00
    expect(d.getUTCHours()).toBe(0)
  })

  it('returns Invalid Date for empty string', () => {
    const d = parseUtcDate('')
    expect(isNaN(d.getTime())).toBe(true)
  })

  it('does not double-adjust strings with T already set (idempotency)', () => {
    const ts = '2026-02-27T01:16:29Z'
    const d1 = parseUtcDate(ts)
    const d2 = parseUtcDate(ts)
    expect(d1.getTime()).toBe(d2.getTime())
  })
})
