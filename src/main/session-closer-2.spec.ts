/**
 * Tests for session-closer — auto-closes started sessions when their task is done,
 * and detects sessions manually closed between poll cycles.
 * T990, T1204
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock ./db ─────────────────────────────────────────────────────────────────
vi.mock('./db', () => ({
  writeDb: vi.fn().mockResolvedValue(undefined),
  assertDbPathAllowed: vi.fn(),
  queryLive: vi.fn().mockResolvedValue([]),
}))

import { writeDb, assertDbPathAllowed, queryLive } from './db'
import { startSessionCloser, stopSessionCloser, closeZombieSessions, detectManuallyClosed } from './session-closer'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('session-closer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    stopSessionCloser() // ensure clean state before each test
  })

  afterEach(() => {
    stopSessionCloser()
    vi.useRealTimers()
  })

  describe('detectManuallyClosed', () => {
    it('should call assertDbPathAllowed', async () => {
      await detectManuallyClosed('/fake/project.db', '2026-01-01 00:00:00')
      expect(assertDbPathAllowed).toHaveBeenCalledWith('/fake/project.db')
    })

    it('should throw if assertDbPathAllowed throws', async () => {
      vi.mocked(assertDbPathAllowed).mockImplementationOnce(() => {
        throw new Error('DB_PATH_NOT_ALLOWED: /evil/db')
      })
      await expect(detectManuallyClosed('/evil/db', '2026-01-01 00:00:00')).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should call queryLive with the correct query and since parameter', async () => {
      const since = '2026-03-09 10:00:00'
      await detectManuallyClosed('/fake/project.db', since)
      expect(queryLive).toHaveBeenCalledWith(
        '/fake/project.db',
        expect.stringContaining("status = 'completed'"),
        [since]
      )
      expect(queryLive).toHaveBeenCalledWith(
        '/fake/project.db',
        expect.stringContaining('ended_at > ?'),
        [since]
      )
      expect(queryLive).toHaveBeenCalledWith(
        '/fake/project.db',
        expect.stringContaining('agent_id IS NOT NULL'),
        [since]
      )
    })

    it('should NOT have NOT EXISTS clauses (T1884 — removed zombie/task guards)', async () => {
      await detectManuallyClosed('/fake/project.db', '2026-01-01 00:00:00')
      const sql = vi.mocked(queryLive).mock.calls[0][1]
      expect(sql).not.toContain('NOT EXISTS')
    })

    it('should return agent_ids from completed sessions even with active started sessions (T1884)', async () => {
      // T1884: NOT EXISTS removed — agents with started sessions are no longer filtered out
      vi.mocked(queryLive).mockResolvedValueOnce([{ agent_id: 5 }])
      const result = await detectManuallyClosed('/fake/project.db', '2026-01-01 00:00:00')
      expect(result).toEqual([5])
    })

    it('should return agent_ids from completed sessions', async () => {
      vi.mocked(queryLive).mockResolvedValueOnce([
        { agent_id: 2 },
        { agent_id: 8 },
      ])
      const result = await detectManuallyClosed('/fake/project.db', '2026-01-01 00:00:00')
      expect(result).toEqual([2, 8])
    })

    it('should return empty array when no sessions were manually closed', async () => {
      vi.mocked(queryLive).mockResolvedValueOnce([])
      const result = await detectManuallyClosed('/fake/project.db', '2026-01-01 00:00:00')
      expect(result).toEqual([])
    })

    it('should return agents even when they have in_progress tasks (T1884)', async () => {
      // T1884: task guard removed — agents with active tasks are returned
      vi.mocked(queryLive).mockResolvedValueOnce([{ agent_id: 3 }])
      const result = await detectManuallyClosed('/fake/project.db', '2026-01-01 00:00:00')
      expect(result).toEqual([3])
    })

    it('should include agents with no tasks (review, doc)', async () => {
      vi.mocked(queryLive).mockResolvedValueOnce([{ agent_id: 42 }])
      const result = await detectManuallyClosed('/fake/project.db', '2026-01-01 00:00:00')
      expect(result).toEqual([42])
    })
  })
})
