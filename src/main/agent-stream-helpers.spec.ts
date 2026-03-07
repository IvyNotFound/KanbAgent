/**
 * Tests for agent-stream-helpers.ts
 * Covers: UUID_REGEX, buildEnv (HOME fallback, LANG default, var forwarding),
 *         getActiveTasksLine (format, exclusion, DB error)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockQueryLive = vi.hoisted(() => vi.fn())

vi.mock('./db', () => ({
  queryLive: mockQueryLive,
}))

vi.mock('fs', () => {
  const fns = {
    appendFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  }
  return { default: fns, ...fns }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/logs'),
  },
}))

// ── Import after mocks ─────────────────────────────────────────────────────────

import { UUID_REGEX, buildEnv, getActiveTasksLine } from './agent-stream-helpers'

// ── UUID_REGEX ─────────────────────────────────────────────────────────────────

describe('UUID_REGEX', () => {
  it('matches a valid lowercase UUID', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('matches a valid uppercase UUID (case-insensitive)', () => {
    expect(UUID_REGEX.test('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
  })

  it('matches a mixed-case UUID', () => {
    expect(UUID_REGEX.test('550e8400-E29B-41d4-A716-446655440000')).toBe(true)
  })

  it('rejects a UUID without dashes', () => {
    expect(UUID_REGEX.test('550e8400e29b41d4a716446655440000')).toBe(false)
  })

  it('rejects a UUID that is too short (8-4-4-4 only, missing last group)', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716')).toBe(false)
  })

  it('rejects a UUID with non-hex chars', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-44665544000z')).toBe(false)
  })

  it('rejects a UUID with a prefix (anchor ^)', () => {
    expect(UUID_REGEX.test('prefix-550e8400-e29b-41d4-a716-446655440000')).toBe(false)
  })

  it('rejects a UUID with a suffix (anchor $)', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000-suffix')).toBe(false)
  })
})

// ── buildEnv ───────────────────────────────────────────────────────────────────

describe('buildEnv', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('always sets TERM=dumb and NO_COLOR=1', () => {
    const env = buildEnv()
    expect(env.TERM).toBe('dumb')
    expect(env.NO_COLOR).toBe('1')
  })

  it('uses process.env.LANG when defined', () => {
    process.env.LANG = 'fr_FR.UTF-8'
    const env = buildEnv()
    expect(env.LANG).toBe('fr_FR.UTF-8')
  })

  it('falls back to en_US.UTF-8 when LANG is absent', () => {
    delete process.env.LANG
    const env = buildEnv()
    expect(env.LANG).toBe('en_US.UTF-8')
  })

  it('forwards USERPROFILE when present', () => {
    process.env.USERPROFILE = 'C:\\Users\\TestUser'
    const env = buildEnv()
    expect(env.USERPROFILE).toBe('C:\\Users\\TestUser')
  })

  it('forwards APPDATA when present', () => {
    process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming'
    const env = buildEnv()
    expect(env.APPDATA).toBe('C:\\Users\\TestUser\\AppData\\Roaming')
  })

  it('does not include absent optional vars', () => {
    delete process.env.SystemRoot
    delete process.env.COMPUTERNAME
    const env = buildEnv()
    expect(env.SystemRoot).toBeUndefined()
    expect(env.COMPUTERNAME).toBeUndefined()
  })

  it('sets HOME from USERPROFILE when HOME is absent', () => {
    delete process.env.HOME
    process.env.USERPROFILE = 'C:\\Users\\TestUser'
    const env = buildEnv()
    expect(env.HOME).toBe('C:\\Users\\TestUser')
  })

  it('does not overwrite HOME if HOME is already present', () => {
    process.env.HOME = '/home/user'
    process.env.USERPROFILE = 'C:\\Users\\TestUser'
    const env = buildEnv()
    expect(env.HOME).toBe('/home/user')
  })

  it('does not set HOME when both HOME and USERPROFILE are absent', () => {
    delete process.env.HOME
    delete process.env.USERPROFILE
    const env = buildEnv()
    // HOME is not in forwardVars explicitly and no USERPROFILE fallback
    // HOME is in forwardVars so if absent it won't be set unless USERPROFILE present
    expect(env.HOME).toBeUndefined()
  })
})

// ── getActiveTasksLine ─────────────────────────────────────────────────────────

describe('getActiveTasksLine', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns formatted string for multiple active tasks', async () => {
    mockQueryLive.mockResolvedValue([{ id: 42 }, { id: 67 }])
    const result = await getActiveTasksLine('/path/to/db', 1)
    expect(result).toBe('Active tasks: #42 #67')
  })

  it('returns empty string when no active tasks', async () => {
    mockQueryLive.mockResolvedValue([])
    const result = await getActiveTasksLine('/path/to/db', 1)
    expect(result).toBe('')
  })

  it('returns empty string on DB error', async () => {
    mockQueryLive.mockRejectedValue(new Error('DB unavailable'))
    const result = await getActiveTasksLine('/path/to/db', 1)
    expect(result).toBe('')
  })

  it('passes currentSessionId as exclusion parameter', async () => {
    mockQueryLive.mockResolvedValue([])
    await getActiveTasksLine('/my/db', 99)
    expect(mockQueryLive).toHaveBeenCalledWith(
      '/my/db',
      expect.stringContaining('s.id != ?'),
      [99]
    )
  })

  it('returns single task formatted correctly', async () => {
    mockQueryLive.mockResolvedValue([{ id: 101 }])
    const result = await getActiveTasksLine('/path/to/db', 5)
    expect(result).toBe('Active tasks: #101')
  })

  it('passes dbPath to queryLive', async () => {
    mockQueryLive.mockResolvedValue([])
    await getActiveTasksLine('/specific/path.db', 1)
    expect(mockQueryLive).toHaveBeenCalledWith('/specific/path.db', expect.any(String), expect.any(Array))
  })
})
