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

  describe('createWorktree', () => {
    it('calls git worktree add -b with correct args', async () => {
      mockSuccess()
      await createWorktree(REPO, SESSION_ID)

      expect(mockExecFile).toHaveBeenCalledOnce()
      const [, args] = mockExecFile.mock.calls[0] as [string, string[], ExecFileCb]
      expect(args).toEqual(['-C', REPO, 'worktree', 'add', '-b', EXPECTED_BRANCH, EXPECTED_WT_PATH, 'HEAD'])
    })

    it('returns correct path and branch on success', async () => {
      mockSuccess()
      const result = await createWorktree(REPO, SESSION_ID)
      expect(result).toEqual({ path: EXPECTED_WT_PATH, branch: EXPECTED_BRANCH })
    })

    it('falls back to attach (without -b) when branch already exists', async () => {
      let callCount = 0
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: ExecFileCb) => {
          callCount++
          if (callCount === 1) cb(new Error("fatal: A branch named 'agent/42' already exists."))
          else cb(null)
        }
      )

      const result = await createWorktree(REPO, SESSION_ID)

      expect(mockExecFile).toHaveBeenCalledTimes(2)
      const [, secondArgs] = mockExecFile.mock.calls[1] as [string, string[], ExecFileCb]
      expect(secondArgs).toEqual(['-C', REPO, 'worktree', 'add', EXPECTED_WT_PATH, EXPECTED_BRANCH])
      expect(result).toEqual({ path: EXPECTED_WT_PATH, branch: EXPECTED_BRANCH })
    })

    it('falls back when error message contains "already linked"', async () => {
      let callCount = 0
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: ExecFileCb) => {
          callCount++
          if (callCount === 1) cb(new Error('already linked'))
          else cb(null)
        }
      )

      await expect(createWorktree(REPO, SESSION_ID)).resolves.toEqual({ path: EXPECTED_WT_PATH, branch: EXPECTED_BRANCH })
      expect(mockExecFile).toHaveBeenCalledTimes(2)
    })

    it('throws on unknown git error', async () => {
      mockError('fatal: not a git repository')
      await expect(createWorktree(REPO, SESSION_ID)).rejects.toThrow('fatal: not a git repository')
    })
  })

  // ── removeWorktree ──────────────────────────────────────────────────────────

  describe('removeWorktree', () => {
    it('calls git worktree remove --force then branch -D', async () => {
      mockSuccess()
      await removeWorktree(REPO, SESSION_ID)

      expect(mockExecFile).toHaveBeenCalledTimes(2)
      const [, firstArgs] = mockExecFile.mock.calls[0] as [string, string[], ExecFileCb]
      expect(firstArgs).toEqual(['-C', REPO, 'worktree', 'remove', '--force', EXPECTED_WT_PATH])
      const [, secondArgs] = mockExecFile.mock.calls[1] as [string, string[], ExecFileCb]
      expect(secondArgs).toEqual(['-C', REPO, 'branch', '-D', EXPECTED_BRANCH])
    })

    it('silently ignores error from worktree remove and still calls branch -D', async () => {
      let callCount = 0
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: ExecFileCb) => {
          callCount++
          if (callCount === 1) cb(new Error('worktree not found'))
          else cb(null)
        }
      )

      await expect(removeWorktree(REPO, SESSION_ID)).resolves.toBeUndefined()
      expect(mockExecFile).toHaveBeenCalledTimes(2)
    })

    it('silently ignores error from branch -D', async () => {
      let callCount = 0
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], cb: ExecFileCb) => {
          callCount++
          if (callCount === 2) cb(new Error('branch not found'))
          else cb(null)
        }
      )

      await expect(removeWorktree(REPO, SESSION_ID)).resolves.toBeUndefined()
    })

    it('silently ignores both errors and resolves', async () => {
      mockError('some git error')
      await expect(removeWorktree(REPO, SESSION_ID)).resolves.toBeUndefined()
    })
  })

  // ── pruneWorktrees ──────────────────────────────────────────────────────────

  describe('pruneWorktrees', () => {
    it('calls git worktree prune with repo root', async () => {
      mockSuccess()
      await pruneWorktrees(REPO)

      expect(mockExecFile).toHaveBeenCalledOnce()
      const [, args] = mockExecFile.mock.calls[0] as [string, string[], ExecFileCb]
      expect(args).toEqual(['-C', REPO, 'worktree', 'prune'])
    })

    it('propagates errors from git worktree prune', async () => {
      mockError('fatal: not a git repository')
      await expect(pruneWorktrees(REPO)).rejects.toThrow('fatal: not a git repository')
    })
  })

  // ── removeWorktreeByPath ────────────────────────────────────────────────────

  describe('removeWorktreeByPath (T1205)', () => {
    const WT_PATH = path.resolve(REPO, '..', 'agent-worktrees', 'my-worktree')
    const PORCELAIN_OUTPUT = [
      `worktree ${REPO}`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      `worktree ${WT_PATH}`,
      'HEAD def456',
      'branch refs/heads/agent/foo/s99',
      '',
    ].join('\n')

    type ExecFileCbWithStdout = (err: Error | null, stdout?: string, stderr?: string) => void

    it('calls list --porcelain, worktree remove --force, then branch -D with extracted branch', async () => {
      let callCount = 0
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        callCount++
        if (callCount === 1) cb(null, PORCELAIN_OUTPUT, '') // list --porcelain
        else cb(null)                                        // worktree remove + branch -D
      })

      await removeWorktreeByPath(REPO, WT_PATH)

      expect(mockExecFile).toHaveBeenCalledTimes(3)
      const [, listArgs] = mockExecFile.mock.calls[0] as [string, string[], ExecFileCbWithStdout]
      expect(listArgs).toEqual(['-C', REPO, 'worktree', 'list', '--porcelain'])
      const [, removeArgs] = mockExecFile.mock.calls[1] as [string, string[], ExecFileCbWithStdout]
      expect(removeArgs).toContain('remove')
      expect(removeArgs).toContain('--force')
      const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], ExecFileCbWithStdout]
      expect(branchArgs).toEqual(['-C', REPO, 'branch', '-D', 'agent/foo/s99'])
    })

    it('is idempotent when worktree remove fails (already removed)', async () => {
      let callCount = 0
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        callCount++
        if (callCount === 1) cb(null, PORCELAIN_OUTPUT, '')  // list --porcelain
        if (callCount === 2) cb(new Error('worktree not found')) // worktree remove
        if (callCount === 3) cb(null) // branch -D
      })

      await expect(removeWorktreeByPath(REPO, WT_PATH)).resolves.toBeUndefined()
      expect(mockExecFile).toHaveBeenCalledTimes(3)
    })

    it('skips branch -D when path not found in porcelain output', async () => {
      let callCount = 0
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        callCount++
        if (callCount === 1) cb(null, 'worktree /other/path\nHEAD abc\nbranch refs/heads/main\n', '')
        else cb(null)
      })

      await removeWorktreeByPath(REPO, WT_PATH)

      // Only list + worktree remove — no branch -D
      expect(mockExecFile).toHaveBeenCalledTimes(2)
    })

    it('is idempotent when list --porcelain fails', async () => {
      let callCount = 0
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCbWithStdout) => {
        callCount++
        if (callCount === 1) cb(new Error('not a git repo')) // list fails
        else cb(null) // worktree remove succeeds
      })

      await expect(removeWorktreeByPath(REPO, WT_PATH)).resolves.toBeUndefined()
      // list + worktree remove (no branch -D since list failed)
      expect(mockExecFile).toHaveBeenCalledTimes(2)
    })
  })

  // ── pruneOrphanedWorktrees ─────────────────────────────────────────────────

})
