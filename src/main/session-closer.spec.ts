/**
 * Tests for session-closer — auto-closes started sessions when their task is done.
 * T990
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock ./db ─────────────────────────────────────────────────────────────────
vi.mock('./db', () => ({
  writeDb: vi.fn().mockResolvedValue(undefined),
  assertDbPathAllowed: vi.fn(),
}))

import { writeDb, assertDbPathAllowed } from './db'
import { startSessionCloser, stopSessionCloser, closeZombieSessions } from './session-closer'

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
      const mockDb = { run: vi.fn() }
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
    })
  })
})
