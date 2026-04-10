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

  describe('startSessionCloser / stopSessionCloser', () => {
    it('should not call writeDb immediately on start', () => {
      startSessionCloser('/fake/project.db')
      expect(writeDb).not.toHaveBeenCalled()
    })

    it('should call closeZombieSessions after 30s when started sessions exist', async () => {
      // pre-check returns a started session
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }])
      startSessionCloser('/fake/project.db')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(writeDb).toHaveBeenCalledWith('/fake/project.db', expect.any(Function))
    })

    it('should skip poll when no started sessions exist', async () => {
      // pre-check returns empty → no started sessions
      vi.mocked(queryLive).mockResolvedValueOnce([])
      startSessionCloser('/fake/project.db')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(writeDb).not.toHaveBeenCalled()
    })

    it('should call closeZombieSessions repeatedly every 30s', async () => {
      // 3 cycles, each needs a pre-check returning a started session
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }]) // cycle 1 pre-check
      vi.mocked(queryLive).mockResolvedValueOnce([])            // cycle 1 detectManuallyClosed
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }]) // cycle 2 pre-check
      vi.mocked(queryLive).mockResolvedValueOnce([])            // cycle 2 detectManuallyClosed
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }]) // cycle 3 pre-check
      vi.mocked(queryLive).mockResolvedValueOnce([])            // cycle 3 detectManuallyClosed
      startSessionCloser('/fake/project.db')
      await vi.advanceTimersByTimeAsync(90_000)
      expect(writeDb).toHaveBeenCalledTimes(3)
    })

    it('should stop interval on stopSessionCloser', async () => {
      startSessionCloser('/fake/project.db')
      stopSessionCloser()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(writeDb).not.toHaveBeenCalled()
    })

    it('should replace previous poller on second startSessionCloser call', async () => {
      // pre-check for the second poller returns a started session
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }])
      startSessionCloser('/fake/project.db')
      startSessionCloser('/fake/project2.db')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(writeDb).toHaveBeenCalledTimes(1)
      expect(writeDb).toHaveBeenCalledWith('/fake/project2.db', expect.any(Function))
    })

    it('should invoke onSessionsClosed callback with agent_ids when zombie sessions are closed', async () => {
      const mockDb = {
        exec: vi.fn()
          .mockReturnValueOnce([{ columns: ['id', 'agent_id'], values: [[10, 5], [11, 7]] }])
          .mockReturnValueOnce([]), // no stale sessions
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(2),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => { fn(mockDb); return undefined })
      // pre-check: started sessions exist
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }])
      const onSessionsClosed = vi.fn()
      startSessionCloser('/fake/project.db', onSessionsClosed)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(onSessionsClosed).toHaveBeenCalledWith([5, 7])
    })

    it('should NOT invoke onSessionsClosed when no sessions are closed', async () => {
      // pre-check: started sessions exist (but zombie-close finds nothing eligible)
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }])
      // detectManuallyClosed returns nothing
      vi.mocked(queryLive).mockResolvedValueOnce([])
      const onSessionsClosed = vi.fn()
      startSessionCloser('/fake/project.db', onSessionsClosed)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(onSessionsClosed).not.toHaveBeenCalled()
    })

    it('should invoke onSessionsClosed with manually-closed agent_ids (no assigned tasks)', async () => {
      // pre-check: started sessions exist
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }])
      // zombie-close returns nothing
      vi.mocked(writeDb).mockResolvedValue(undefined)
      // manually-closed returns review agent
      vi.mocked(queryLive).mockResolvedValueOnce([{ agent_id: 42 }])
      const onSessionsClosed = vi.fn()
      startSessionCloser('/fake/project.db', onSessionsClosed)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(onSessionsClosed).toHaveBeenCalledWith([42])
    })

    it('should deduplicate agent_ids appearing in both zombie-close and manually-closed', async () => {
      // pre-check: started sessions exist
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }])
      // zombie-close returns [5, 7], no stale sessions
      const mockDb = {
        exec: vi.fn()
          .mockReturnValueOnce([{ columns: ['id', 'agent_id'], values: [[10, 5], [11, 7]] }])
          .mockReturnValueOnce([]), // no stale sessions
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(2),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => { fn(mockDb); return undefined })
      // manually-closed returns [7, 9] (7 appears in both)
      vi.mocked(queryLive).mockResolvedValueOnce([{ agent_id: 7 }, { agent_id: 9 }])
      const onSessionsClosed = vi.fn()
      startSessionCloser('/fake/project.db', onSessionsClosed)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(onSessionsClosed).toHaveBeenCalledTimes(1)
      expect(onSessionsClosed).toHaveBeenCalledWith(expect.arrayContaining([5, 7, 9]))
      expect(onSessionsClosed.mock.calls[0][0]).toHaveLength(3)
    })

    it('should call detectManuallyClosed on every cycle', async () => {
      // 3 cycles: each needs pre-check + detectManuallyClosed
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }]) // cycle 1 pre-check
      vi.mocked(queryLive).mockResolvedValueOnce([])            // cycle 1 detectManuallyClosed
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }]) // cycle 2 pre-check
      vi.mocked(queryLive).mockResolvedValueOnce([])            // cycle 2 detectManuallyClosed
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }]) // cycle 3 pre-check
      vi.mocked(queryLive).mockResolvedValueOnce([])            // cycle 3 detectManuallyClosed
      startSessionCloser('/fake/project.db')
      await vi.advanceTimersByTimeAsync(90_000)
      // 3 pre-checks + 3 detectManuallyClosed = 6 queryLive calls
      expect(queryLive).toHaveBeenCalledTimes(6)
    })

    it('should update lastCheckedAt between cycles (no re-emission of prev cycle sessions)', async () => {
      // First cycle: pre-check + manually-closed returns agent 10
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }])    // cycle 1 pre-check
      vi.mocked(queryLive).mockResolvedValueOnce([{ agent_id: 10 }]) // cycle 1 detectManuallyClosed
      // Second cycle: pre-check + manually-closed returns nothing
      vi.mocked(queryLive).mockResolvedValueOnce([{ '1': 1 }])    // cycle 2 pre-check
      vi.mocked(queryLive).mockResolvedValueOnce([])               // cycle 2 detectManuallyClosed
      const onSessionsClosed = vi.fn()
      startSessionCloser('/fake/project.db', onSessionsClosed)
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.advanceTimersByTimeAsync(30_000)
      // Agent 10 should only be emitted once
      expect(onSessionsClosed).toHaveBeenCalledTimes(1)
      expect(onSessionsClosed).toHaveBeenCalledWith([10])
    })
  })

  describe('closeZombieSessions', () => {
    it('should call assertDbPathAllowed with the dbPath', async () => {
      await closeZombieSessions('/fake/project.db')
      expect(assertDbPathAllowed).toHaveBeenCalledWith('/fake/project.db')
    })

    it('should call writeDb with the provided dbPath', async () => {
      await closeZombieSessions('/fake/project.db')
      expect(writeDb).toHaveBeenCalledWith('/fake/project.db', expect.any(Function))
    })

    it('should throw if assertDbPathAllowed throws', async () => {
      vi.mocked(assertDbPathAllowed).mockImplementationOnce(() => {
        throw new Error('DB_PATH_NOT_ALLOWED: /evil/db')
      })
      await expect(closeZombieSessions('/evil/db')).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should pass a callback that runs UPDATE with WHERE id IN (...) from SELECT results', async () => {
      const mockDb = {
        exec: vi.fn()
          .mockReturnValueOnce([{ columns: ['id', 'agent_id'], values: [[100, 1]] }])
          .mockReturnValueOnce([]), // no stale sessions
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(1),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => {
        fn(mockDb)
        return undefined
      })
      await closeZombieSessions('/fake/project.db')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions'),
        [100]
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("status = 'completed'"),
        expect.any(Array)
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id IN (?)'),
        [100]
      )
    })

    it('callback returns false when no eligible sessions (T1110 skip-write signal)', async () => {
      const mockDb = {
        exec: vi.fn().mockReturnValue([]), // both zombie and stale return empty
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(0),
      }
      let callbackResult: unknown
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => {
        callbackResult = fn(mockDb)
        return callbackResult
      })
      await closeZombieSessions('/fake/project.db')
      expect(callbackResult).toBe(false)
    })

    it('callback returns false when getRowsModified() === 0 (T1110 skip-write signal)', async () => {
      const mockDb = {
        exec: vi.fn()
          .mockReturnValueOnce([{ columns: ['id', 'agent_id'], values: [[100, 1]] }])
          .mockReturnValueOnce([]), // no stale sessions
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(0),
      }
      let callbackResult: unknown
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => {
        callbackResult = fn(mockDb)
        return callbackResult
      })
      await closeZombieSessions('/fake/project.db')
      expect(callbackResult).toBe(false)
    })

    it('callback returns true when getRowsModified() > 0 (T1110 write proceeds)', async () => {
      const mockDb = {
        exec: vi.fn()
          .mockReturnValueOnce([{ columns: ['id', 'agent_id'], values: [[100, 1]] }])
          .mockReturnValueOnce([]), // no stale sessions
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(2),
      }
      let callbackResult: unknown
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => {
        callbackResult = fn(mockDb)
        return callbackResult
      })
      await closeZombieSessions('/fake/project.db')
      expect(callbackResult).toBe(true)
    })

    it('returns the closed agent_ids (deduplicated)', async () => {
      const mockDb = {
        exec: vi.fn()
          .mockReturnValueOnce([{ columns: ['id', 'agent_id'], values: [[10, 3], [11, 9], [12, 3]] }])
          .mockReturnValueOnce([]), // no stale sessions
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(3),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => { fn(mockDb); return undefined })
      const result = await closeZombieSessions('/fake/project.db')
      expect(result).toEqual([3, 9])
    })

    it('returns empty array when no sessions are eligible', async () => {
      const mockDb = {
        exec: vi.fn().mockReturnValue([]), // both zombie and stale return empty
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(0),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => { fn(mockDb); return undefined })
      const result = await closeZombieSessions('/fake/project.db')
      expect(result).toEqual([])
    })

    it('closes stale sessions started > 2 hours ago regardless of task status (T1884)', async () => {
      const mockDb = {
        exec: vi.fn()
          .mockReturnValueOnce([]) // no zombie-eligible sessions
          .mockReturnValueOnce([{ columns: ['id', 'agent_id'], values: [[50, 4], [51, 6]] }]), // stale sessions
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(2),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => { fn(mockDb); return undefined })
      const result = await closeZombieSessions('/fake/project.db')
      expect(result).toEqual([4, 6])
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id IN (?,?)'),
        [50, 51]
      )
    })

    it('deduplicates agent_ids between zombie-close and stale-close (T1884)', async () => {
      const mockDb = {
        exec: vi.fn()
          .mockReturnValueOnce([{ columns: ['id', 'agent_id'], values: [[10, 5]] }]) // zombie
          .mockReturnValueOnce([{ columns: ['id', 'agent_id'], values: [[50, 5], [51, 8]] }]), // stale (agent 5 in both)
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(3),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => { fn(mockDb); return undefined })
      const result = await closeZombieSessions('/fake/project.db')
      expect(result).toEqual(expect.arrayContaining([5, 8]))
      expect(result).toHaveLength(2)
    })

    it('stale query uses correct SQL with 2-hour threshold (T1884)', async () => {
      const mockDb = {
        exec: vi.fn().mockReturnValue([]),
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(0),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => { fn(mockDb); return undefined })
      await closeZombieSessions('/fake/project.db')
      // Second exec call is the stale query
      const staleSql = mockDb.exec.mock.calls[1][0] as string
      expect(staleSql).toContain("status = 'started'")
      expect(staleSql).toContain("datetime('now', '-2 hours')")
      expect(staleSql).toContain('agent_id IS NOT NULL')
    })
  })

})
