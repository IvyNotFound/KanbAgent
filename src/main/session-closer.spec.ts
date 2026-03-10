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

    it('should call closeZombieSessions after 30s', async () => {
      startSessionCloser('/fake/project.db')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(writeDb).toHaveBeenCalledWith('/fake/project.db', expect.any(Function))
    })

    it('should call closeZombieSessions repeatedly every 30s', async () => {
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
      startSessionCloser('/fake/project.db')
      startSessionCloser('/fake/project2.db')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(writeDb).toHaveBeenCalledTimes(1)
      expect(writeDb).toHaveBeenCalledWith('/fake/project2.db', expect.any(Function))
    })

    it('should invoke onSessionsClosed callback with agent_ids when zombie sessions are closed', async () => {
      const mockDb = {
        exec: vi.fn().mockReturnValue([{ columns: ['agent_id'], values: [[5], [7]] }]),
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(2),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => { fn(mockDb); return undefined })
      const onSessionsClosed = vi.fn()
      startSessionCloser('/fake/project.db', onSessionsClosed)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(onSessionsClosed).toHaveBeenCalledWith([5, 7])
    })

    it('should NOT invoke onSessionsClosed when no sessions are closed', async () => {
      // default mocks resolve to empty → closedAgentIds stays []
      const onSessionsClosed = vi.fn()
      startSessionCloser('/fake/project.db', onSessionsClosed)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(onSessionsClosed).not.toHaveBeenCalled()
    })

    it('should invoke onSessionsClosed with manually-closed agent_ids (no assigned tasks)', async () => {
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
      // zombie-close returns [5, 7]
      const mockDb = {
        exec: vi.fn().mockReturnValue([{ columns: ['agent_id'], values: [[5], [7]] }]),
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
      startSessionCloser('/fake/project.db')
      await vi.advanceTimersByTimeAsync(90_000)
      expect(queryLive).toHaveBeenCalledTimes(3)
    })

    it('should update lastCheckedAt between cycles (no re-emission of prev cycle sessions)', async () => {
      // First cycle: manually-closed returns agent 10
      vi.mocked(queryLive).mockResolvedValueOnce([{ agent_id: 10 }])
      // Second cycle: manually-closed returns nothing (lastCheckedAt advanced past it)
      vi.mocked(queryLive).mockResolvedValueOnce([])
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

    it('should pass a callback that runs the UPDATE query with agent_id logic', async () => {
      // exec returns one agent_id so the UPDATE path is reached
      const mockDb = {
        exec: vi.fn().mockReturnValue([{ columns: ['agent_id'], values: [[1]] }]),
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(1),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => {
        fn(mockDb)
        return undefined
      })
      await closeZombieSessions('/fake/project.db')
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions')
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("status = 'completed'")
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('agent_id IS NOT NULL')
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS')
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("t.status IN ('todo', 'in_progress')")
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('t.agent_assigned_id = sessions.agent_id')
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining("t.status = 'done'")
      )
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('sessions.started_at')
      )
    })

    it('callback returns false when no eligible sessions (T1110 skip-write signal)', async () => {
      const mockDb = {
        exec: vi.fn().mockReturnValue([]),
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
        exec: vi.fn().mockReturnValue([{ columns: ['agent_id'], values: [[1]] }]),
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
        exec: vi.fn().mockReturnValue([{ columns: ['agent_id'], values: [[1]] }]),
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

    it('returns the closed agent_ids', async () => {
      const mockDb = {
        exec: vi.fn().mockReturnValue([{ columns: ['agent_id'], values: [[3], [9]] }]),
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(2),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => { fn(mockDb); return undefined })
      const result = await closeZombieSessions('/fake/project.db')
      expect(result).toEqual([3, 9])
    })

    it('returns empty array when no sessions are eligible', async () => {
      const mockDb = {
        exec: vi.fn().mockReturnValue([]),
        run: vi.fn(),
        getRowsModified: vi.fn().mockReturnValue(0),
      }
      vi.mocked(writeDb).mockImplementationOnce(async (_path, fn) => { fn(mockDb); return undefined })
      const result = await closeZombieSessions('/fake/project.db')
      expect(result).toEqual([])
    })
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
      // Guard: must exclude agents that have an active 'started' session (prevents zombie-close
      // sessions created by dbstart.js from triggering tab closure on the newly opened session)
      expect(queryLive).toHaveBeenCalledWith(
        '/fake/project.db',
        expect.stringContaining("s2.status = 'started'"),
        [since]
      )
    })

    it('should NOT return agent_ids when agent has an active started session (anti-zombie-false-positive)', async () => {
      // Simulate: queryLive returns nothing because the NOT EXISTS clause filters out
      // agents that have a 'started' session (i.e. a new session was just opened after
      // the zombie-close done by dbstart.js).
      vi.mocked(queryLive).mockResolvedValueOnce([])
      const result = await detectManuallyClosed('/fake/project.db', '2026-01-01 00:00:00')
      expect(result).toEqual([])
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
  })
})
