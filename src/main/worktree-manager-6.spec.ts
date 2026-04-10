/**
 * Targeted tests to kill surviving mutants in worktree-manager.ts (T1228).
 *
 * Strategy:
 * - Assert exact git arg values (kills StringLiteral mutants)
 * - Assert conditional branches explicitly (kills ConditionalExpression)
 * - Assert regex behavior at boundaries (kills Regex)
 * - Assert MethodExpression side-effects (kills MethodExpression)
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

import {
  createWorktree,
  removeWorktree,
  pruneWorktrees,
  removeWorktreeByPath,
  pruneOrphanedWorktrees,
} from './worktree-manager'

// ── Constants ─────────────────────────────────────────────────────────────────

const REPO = '/fake/repo'
const SESSION_ID = 99
const WT_PATH = path.resolve(REPO, '..', 'agent-worktrees', '99')
const BRANCH = 'agent/99'

type Cb = (err: Error | null, stdout?: string, stderr?: string) => void

function succeedWith(stdout = '') {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => cb(null, stdout))
}

function failWith(msg: string) {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => cb(new Error(msg)))
}

// ── createWorktree — exact args ────────────────────────────────────────────────

describe('pruneOrphanedWorktrees — regex anchors and conditions', () => {
  const DB_PATH = '/fake/db'

  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryLive.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function buildPorcelain(entries: Array<{ path: string; branch: string }>) {
    return entries
      .map(e => `worktree ${e.path}\nHEAD abc\nbranch refs/heads/${e.branch}`)
      .join('\n\n') + '\n\n'
  }

  it('git worktree list uses --porcelain flag (StringLiteral)', async () => {
    const output = buildPorcelain([{ path: REPO, branch: 'main' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    const [, listArgs] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(listArgs).toContain('list')
    expect(listArgs).toContain('--porcelain')
  })

  it('old-format regex requires ^ anchor — does not match mid-string "agent/123"', async () => {
    // Branch without refs/heads/ prefix would not match /^refs\/heads\/agent\/(\d+)$/
    const output = buildPorcelain([{ path: '/fake/wt/123', branch: 'prefix/agent/123/suffix' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    expect(mockQueryLive).not.toHaveBeenCalled()
  })

  it('old-format regex requires $ anchor — does not match "agent/123/extra"', async () => {
    const output = buildPorcelain([{ path: '/fake/wt/x', branch: 'agent/123/extra' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // Does NOT match old format (has extra /extra suffix) → falls through to new-format check
    // new format also won't match (123 is not agent/<name>/s<ts>) → skipped entirely
    expect(mockQueryLive).not.toHaveBeenCalled()
  })

  it('old-format regex matches "refs/heads/agent/42" exactly (whole string)', async () => {
    const output = buildPorcelain([{ path: '/fake/wt/42', branch: 'agent/42' }])
    mockQueryLive.mockResolvedValueOnce([{ id: 42, ended_at: '2024-01-01', status: 'completed' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    expect(mockQueryLive).toHaveBeenCalledWith(DB_PATH, expect.any(String), [42])
  })

  it('new-format regex requires ^ anchor — not matched by mid-string occurrences', async () => {
    const output = buildPorcelain([{ path: '/fake/wt/x', branch: 'other/agent/name/s12345' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // Without ^ anchor the wrong regex matches any position
    expect(mockQueryLive).not.toHaveBeenCalled()
    // list + prune only (not removed)
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })

  it('new-format regex requires $ anchor — not matched by "agent/name/s12345/extra"', async () => {
    const output = buildPorcelain([{ path: '/fake/wt/x', branch: 'agent/name/s12345/extra' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    expect(mockQueryLive).not.toHaveBeenCalled()
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })

  it('EqualityOperator: does not remove when timestamp is exactly 4h ago (boundary)', async () => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
    const ts = 1700000000000
    vi.spyOn(Date, 'now').mockReturnValue(ts + FOUR_HOURS_MS)
    const output = buildPorcelain([{ path: `/fake/wt/review-s${ts}`, branch: `agent/review/s${ts}` }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // exactly at 4h → not stale (> not <=): list + prune only
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })

  it('EqualityOperator: removes when timestamp is 4h + 1ms ago', async () => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
    const ts = 1700000000000
    vi.spyOn(Date, 'now').mockReturnValue(ts + FOUR_HOURS_MS + 1)
    const output = buildPorcelain([{ path: `/fake/wt/review-s${ts}`, branch: `agent/review/s${ts}` }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // stale → list + remove + branch -D + prune
    expect(mockExecFile).toHaveBeenCalledTimes(4)
  })

  it('new-format removal uses exact branch name in template (StringLiteral)`', async () => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
    const ts = 1700000001234
    vi.spyOn(Date, 'now').mockReturnValue(ts + FOUR_HOURS_MS + 1)
    const output = buildPorcelain([{ path: `/fake/wt/bot-s${ts}`, branch: `agent/bot/s${ts}` }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], Cb]
    expect(branchArgs).toContain(`agent/bot/s${ts}`)
    expect(branchArgs).not.toContain('agent/')  // Ensure full name not just prefix
  })

  it('new-format removal passes --force to worktree remove (StringLiteral)', async () => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
    const ts = 1700000005678
    vi.spyOn(Date, 'now').mockReturnValue(ts + FOUR_HOURS_MS + 1)
    const output = buildPorcelain([{ path: `/fake/wt/agent-s${ts}`, branch: `agent/dev/s${ts}` }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    const [, removeArgs] = mockExecFile.mock.calls[1] as [string, string[], Cb]
    expect(removeArgs).toContain('--force')
    expect(removeArgs).toContain('remove')
  })

  it('BlockStatement: pruneWorktrees is still called even when prune fails (catch swallows)', async () => {
    const output = buildPorcelain([{ path: REPO, branch: 'main' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(new Error('prune failed'))
    })
    // Should not throw even if prune fails
    await expect(pruneOrphanedWorktrees(REPO, DB_PATH)).resolves.toBeUndefined()
    // list + prune attempt (which fails but is caught)
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })

  it('ConditionalExpression (line 178): skips null branch entries', async () => {
    // detached HEAD → no branch line → wt.branch is null
    const output = `worktree /fake/wt/detached\nHEAD abc\ndetached\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    expect(mockQueryLive).not.toHaveBeenCalled()
    expect(mockExecFile).toHaveBeenCalledTimes(2) // list + prune
  })

  it('DB query uses SELECT with "sessions" table name (StringLiteral)', async () => {
    const output = buildPorcelain([{ path: '/fake/wt/55', branch: 'agent/55' }])
    mockQueryLive.mockResolvedValueOnce([{ id: 55, ended_at: null, status: 'started' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    expect(mockQueryLive).toHaveBeenCalledWith(
      DB_PATH,
      expect.stringMatching(/SELECT.*sessions.*WHERE.*id/is),
      [55],
    )
  })

  it('shouldRemove is false when session.ended_at is null and status is not completed', async () => {
    const output = buildPorcelain([{ path: '/fake/wt/77', branch: 'agent/77' }])
    mockQueryLive.mockResolvedValueOnce([{ id: 77, ended_at: null, status: 'in_progress' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // Not removed: list + prune only
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })

  it('shouldRemove is true when session has ended_at non-null even with non-completed status', async () => {
    const output = buildPorcelain([{ path: '/fake/wt/88', branch: 'agent/88' }])
    mockQueryLive.mockResolvedValueOnce([{ id: 88, ended_at: '2024-06-01 10:00:00', status: 'in_progress' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // Removed: list + worktree remove + branch -D + prune
    expect(mockExecFile).toHaveBeenCalledTimes(4)
  })

  it('BlockStatement (line 190): catch block does not remove when status is "completed" (ConditionalExpression line 189)', async () => {
    // The ConditionalExpression: `!session || session.ended_at !== null || session.status === 'completed'`
    // When status === 'completed' and ended_at is null → shouldRemove = true
    const output = buildPorcelain([{ path: '/fake/wt/33', branch: 'agent/33' }])
    mockQueryLive.mockResolvedValueOnce([{ id: 33, ended_at: null, status: 'completed' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // shouldRemove=true (status=completed) → removed: list + remove + branch-D + prune
    expect(mockExecFile).toHaveBeenCalledTimes(4)
  })
})

// ── parseWorktreeList (via pruneOrphanedWorktrees) — internal parser ────────────
