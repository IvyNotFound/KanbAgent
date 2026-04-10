/**
 * Unit tests for worktree-manager.ts
 * Covers createWorktree, removeWorktree, pruneWorktrees, removeWorktreeByPath,
 * and pruneOrphanedWorktrees.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'

// ── child_process mock ────────────────────────────────────────────────────────

const mockExecFile = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  default: { execFile: mockExecFile },
  execFile: mockExecFile,
}))

// ── db mock ───────────────────────────────────────────────────────────────────

const mockQueryLive = vi.hoisted(() => vi.fn())

vi.mock('./db', () => ({
  queryLive: mockQueryLive,
}))

import { createWorktree, removeWorktree, pruneWorktrees, removeWorktreeByPath, pruneOrphanedWorktrees, parseWorktreeList } from './worktree-manager'

// ── Helpers ────────────────────────────────────────────────────────────────────

const REPO = '/fake/project'
const SESSION_ID = 42
const EXPECTED_WT_PATH = path.resolve(REPO, '..', 'agent-worktrees', '42')
const EXPECTED_BRANCH = 'agent/42'

type ExecFileCb = (err: Error | null) => void

/** Make every execFile call succeed. */
function mockSuccess() {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], cb: ExecFileCb) => cb(null)
  )
}

/** Make every execFile call fail with the given message. */
function mockError(message: string) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], cb: ExecFileCb) => cb(new Error(message))
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('worktree-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── createWorktree ──────────────────────────────────────────────────────────

  describe('pruneOrphanedWorktrees', () => {
    const DB_PATH = '/fake/.claude/project.db'

    /** Build a git worktree list --porcelain output string. */
    function porcelainOutput(worktrees: Array<{ path: string; branch?: string }>): string {
      return worktrees
        .map(wt => [
          `worktree ${wt.path}`,
          'HEAD abc123',
          ...(wt.branch ? [`branch refs/heads/${wt.branch}`] : ['detached']),
        ].join('\n'))
        .join('\n\n')
    }

    type ExecFileCbWithStdout = (err: Error | null, stdout?: string, stderr?: string) => void

    beforeEach(() => {
      mockQueryLive.mockResolvedValue([])
    })

    it('removes worktree for completed session', async () => {
      const output = porcelainOutput([
        { path: REPO, branch: 'main' },
        { path: '/fake/agent-worktrees/10', branch: 'agent/10' },
      ])
      mockQueryLive.mockResolvedValueOnce([{ id: 10, ended_at: '2024-01-01 12:00:00', status: 'completed' }])
      let callCount = 0
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        callCount++
        if (callCount === 1) cb(null, output) // list --porcelain
        else cb(null)
      })

      await pruneOrphanedWorktrees(REPO, DB_PATH)

      // list + removeWorktree (worktree remove + branch -D) + pruneWorktrees
      expect(mockExecFile).toHaveBeenCalledTimes(4)
      const [, removeArgs] = mockExecFile.mock.calls[1] as [string, string[], ExecFileCbWithStdout]
      expect(removeArgs).toContain('remove')
      const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], ExecFileCbWithStdout]
      expect(branchArgs).toContain('-D')
      expect(branchArgs).toContain('agent/10')
    })

    it('removes worktree whose session has ended_at set', async () => {
      const output = porcelainOutput([
        { path: '/fake/agent-worktrees/20', branch: 'agent/20' },
      ])
      mockQueryLive.mockResolvedValueOnce([{ id: 20, ended_at: '2024-01-01 10:00:00', status: 'started' }])
      let callCount = 0
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        callCount++
        if (callCount === 1) cb(null, output)
        else cb(null)
      })

      await pruneOrphanedWorktrees(REPO, DB_PATH)

      expect(mockQueryLive).toHaveBeenCalledWith(DB_PATH, expect.stringContaining('sessions'), [20])
      // list + worktree remove + branch -D + prune
      expect(mockExecFile).toHaveBeenCalledTimes(4)
    })

    it('removes worktree orphaned (session absent from DB)', async () => {
      const output = porcelainOutput([
        { path: '/fake/agent-worktrees/99', branch: 'agent/99' },
      ])
      mockQueryLive.mockResolvedValueOnce([]) // no session in DB
      let callCount = 0
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        callCount++
        if (callCount === 1) cb(null, output)
        else cb(null)
      })

      await pruneOrphanedWorktrees(REPO, DB_PATH)

      // list + worktree remove + branch -D + prune
      expect(mockExecFile).toHaveBeenCalledTimes(4)
    })

    it('preserves worktree for started session without ended_at', async () => {
      const output = porcelainOutput([
        { path: '/fake/agent-worktrees/5', branch: 'agent/5' },
      ])
      mockQueryLive.mockResolvedValueOnce([{ id: 5, ended_at: null, status: 'started' }])
      let callCount = 0
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        callCount++
        if (callCount === 1) cb(null, output)
        else cb(null)
      })

      await pruneOrphanedWorktrees(REPO, DB_PATH)

      // list + prune only (no removeWorktree)
      expect(mockExecFile).toHaveBeenCalledTimes(2)
    })

    it('skips non-agent branches (main worktree, other branches)', async () => {
      const output = porcelainOutput([
        { path: REPO, branch: 'main' },
        { path: '/fake/agent-worktrees/other', branch: 'feature/something' },
      ])
      let callCount = 0
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        callCount++
        if (callCount === 1) cb(null, output)
        else cb(null)
      })

      await pruneOrphanedWorktrees(REPO, DB_PATH)

      expect(mockQueryLive).not.toHaveBeenCalled()
      // list + prune only
      expect(mockExecFile).toHaveBeenCalledTimes(2)
    })

    it('returns early without error when git list fails', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        cb(new Error('not a git repo'))
      })

      await expect(pruneOrphanedWorktrees(REPO, DB_PATH)).resolves.toBeUndefined()
      expect(mockQueryLive).not.toHaveBeenCalled()
    })

    it('skips all old-format worktrees when batch DB query fails', async () => {
      const output = porcelainOutput([
        { path: '/fake/agent-worktrees/7', branch: 'agent/7' },
        { path: '/fake/agent-worktrees/8', branch: 'agent/8' },
      ])
      mockQueryLive.mockRejectedValueOnce(new Error('DB locked'))

      let callCount = 0
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        callCount++
        if (callCount === 1) cb(null, output)
        else cb(null)
      })

      await pruneOrphanedWorktrees(REPO, DB_PATH)

      // Batch query failed → all old-format skipped (safe default): list + prune only
      expect(mockExecFile).toHaveBeenCalledTimes(2)
    })

    it('calls git worktree prune at the end', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        cb(null, '')
      })

      await pruneOrphanedWorktrees(REPO, DB_PATH)

      const lastCall = mockExecFile.mock.calls[mockExecFile.mock.calls.length - 1] as [string, string[], ExecFileCbWithStdout]
      const [, lastArgs] = lastCall
      expect(lastArgs).toContain('prune')
    })

    // ── new-format branches: agent/<name>/s<timestamp> (T1207) ────────────────

    describe('new-format branches (T1207)', () => {
      const FIXED_TS = 1741478234567
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

      afterEach(() => {
        vi.restoreAllMocks()
      })

      it('removes new-format worktree when timestamp > 4h', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(FIXED_TS + FOUR_HOURS_MS + 1)
        const wtPath = `/fake/agent-worktrees/review-s${FIXED_TS}`
        const output = porcelainOutput([
          { path: REPO, branch: 'main' },
          { path: wtPath, branch: `agent/review/s${FIXED_TS}` },
        ])
        mockQueryLive.mockResolvedValue([]) // no matching session → fallback to heuristic
        let callCount = 0
        mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
          callCount++
          if (callCount === 1) cb(null, output)
          else cb(null)
        })

        await pruneOrphanedWorktrees(REPO, DB_PATH)

        // list + worktree remove + branch -D + prune
        expect(mockExecFile).toHaveBeenCalledTimes(4)
        const [, removeArgs] = mockExecFile.mock.calls[1] as [string, string[], ExecFileCbWithStdout]
        expect(removeArgs).toContain('remove')
        expect(removeArgs).toContain('--force')
        const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], ExecFileCbWithStdout]
        expect(branchArgs).toContain('-D')
        expect(branchArgs).toContain(`agent/review/s${FIXED_TS}`)
        expect(mockQueryLive).toHaveBeenCalledOnce() // T1274: DB check before heuristic
      })

      it('preserves new-format worktree when timestamp < 4h', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(FIXED_TS + FOUR_HOURS_MS - 1)
        const output = porcelainOutput([
          { path: `/fake/agent-worktrees/review-s${FIXED_TS}`, branch: `agent/review/s${FIXED_TS}` },
        ])
        mockQueryLive.mockResolvedValue([]) // no matching session → fallback to heuristic
        let callCount = 0
        mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
          callCount++
          if (callCount === 1) cb(null, output)
          else cb(null)
        })

        await pruneOrphanedWorktrees(REPO, DB_PATH)

        // list + prune only (no remove)
        expect(mockExecFile).toHaveBeenCalledTimes(2)
        expect(mockQueryLive).toHaveBeenCalledOnce() // T1274: DB check before heuristic
      })

      it('ignores new-format worktree remove errors (best-effort)', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(FIXED_TS + FOUR_HOURS_MS + 1)
        const output = porcelainOutput([
          { path: `/fake/agent-worktrees/review-s${FIXED_TS}`, branch: `agent/review/s${FIXED_TS}` },
        ])
        let callCount = 0
        mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
          callCount++
          if (callCount === 1) cb(null, output)
          else cb(new Error('git error'))
        })

        await expect(pruneOrphanedWorktrees(REPO, DB_PATH)).resolves.toBeUndefined()
        // list + worktree remove (fails) + branch -D (fails) + prune (fails — still called)
        expect(mockExecFile).toHaveBeenCalledTimes(4)
      })

      it('queries DB for new-format branches before temporal heuristic (T1274)', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(FIXED_TS + FOUR_HOURS_MS + 1)
        const output = porcelainOutput([
          { path: `/fake/agent-worktrees/review-s${FIXED_TS}`, branch: `agent/review/s${FIXED_TS}` },
        ])
        mockQueryLive.mockResolvedValue([]) // no matching session → fallback to heuristic
        let callCount = 0
        mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
          callCount++
          if (callCount === 1) cb(null, output)
          else cb(null)
        })

        await pruneOrphanedWorktrees(REPO, DB_PATH)

        expect(mockQueryLive).toHaveBeenCalledOnce()
        const [dbPath, sql, params] = mockQueryLive.mock.calls[0] as [string, string, unknown[]]
        expect(dbPath).toBe(DB_PATH)
        expect(sql).toContain('JOIN agents')
        expect(params[0]).toBe('review') // agentName
      })
    })
  })

  // ── parseWorktreeList ──────────────────────────────────────────────────────

  describe('parseWorktreeList', () => {
    it('parses main worktree and one agent worktree', () => {
      const output = [
        'worktree /repo',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /agent-worktrees/10',
        'HEAD def456',
        'branch refs/heads/agent/10',
        '',
      ].join('\n')

      const result = parseWorktreeList(output)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ path: '/repo', branch: 'refs/heads/main' })
      expect(result[1]).toEqual({ path: '/agent-worktrees/10', branch: 'refs/heads/agent/10' })
    })

    it('returns null branch for detached HEAD', () => {
      const output = 'worktree /repo\nHEAD abc123\ndetached\n'
      const result = parseWorktreeList(output)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ path: '/repo', branch: null })
    })

    it('returns empty array for empty output', () => {
      expect(parseWorktreeList('')).toEqual([])
    })

    it('handles new-format branch agent/<name>/s<timestamp>', () => {
      const ts = 1741478234567
      const output = [
        `worktree /agent-worktrees/review-s${ts}`,
        'HEAD aabbcc',
        `branch refs/heads/agent/review/s${ts}`,
        '',
      ].join('\n')

      const result = parseWorktreeList(output)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        path: `/agent-worktrees/review-s${ts}`,
        branch: `refs/heads/agent/review/s${ts}`,
      })
    })

    it('filters out blocks with empty path', () => {
      const output = '\n\n'
      expect(parseWorktreeList(output)).toEqual([])
    })
  })
})
