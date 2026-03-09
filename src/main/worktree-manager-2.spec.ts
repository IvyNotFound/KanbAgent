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

describe('createWorktree — exact git args (StringLiteral)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes exactly HEAD as base ref', async () => {
    succeedWith()
    await createWorktree(REPO, SESSION_ID)
    const [, args] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(args[7]).toBe('HEAD')          // last arg in: git -C repo worktree add -b branch path HEAD
  })

  it('uses exactly -b flag for new branch', async () => {
    succeedWith()
    await createWorktree(REPO, SESSION_ID)
    const [, args] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(args).toContain('-b')
  })

  it('passes exactly -C and worktree add flags', async () => {
    succeedWith()
    await createWorktree(REPO, SESSION_ID)
    const [, args] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(args[0]).toBe('-C')
    expect(args[2]).toBe('worktree')
    expect(args[3]).toBe('add')
  })

  it('falls back when error contains exactly "already checked out"', async () => {
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(new Error('fatal: already checked out'))
      else cb(null)
    })
    const result = await createWorktree(REPO, SESSION_ID)
    expect(mockExecFile).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ path: WT_PATH, branch: BRANCH })
  })

  it('fallback call omits -b flag', async () => {
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(new Error('already exists'))
      else cb(null)
    })
    await createWorktree(REPO, SESSION_ID)
    const [, fallbackArgs] = mockExecFile.mock.calls[1] as [string, string[], Cb]
    expect(fallbackArgs).not.toContain('-b')
    expect(fallbackArgs).toContain('worktree')
    expect(fallbackArgs).toContain('add')
  })

  it('fallback uses correct branch (not empty string)', async () => {
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(new Error('already exists'))
      else cb(null)
    })
    await createWorktree(REPO, SESSION_ID)
    const [, fallbackArgs] = mockExecFile.mock.calls[1] as [string, string[], Cb]
    expect(fallbackArgs).toContain(BRANCH)
    expect(fallbackArgs).toContain(WT_PATH)
  })
})

// ── removeWorktree — exact args ────────────────────────────────────────────────

describe('removeWorktree — exact git args (StringLiteral)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes --force to worktree remove', async () => {
    succeedWith()
    await removeWorktree(REPO, SESSION_ID)
    const [, firstArgs] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(firstArgs).toContain('--force')
  })

  it('passes -D to branch delete (not -d lowercase)', async () => {
    succeedWith()
    await removeWorktree(REPO, SESSION_ID)
    const [, secondArgs] = mockExecFile.mock.calls[1] as [string, string[], Cb]
    expect(secondArgs).toContain('-D')
    expect(secondArgs).not.toContain('-d')
  })

  it('uses "remove" subcommand (not "delete")', async () => {
    succeedWith()
    await removeWorktree(REPO, SESSION_ID)
    const [, firstArgs] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(firstArgs).toContain('remove')
    expect(firstArgs).not.toContain('delete')
  })

  it('passes exact branch name "agent/99" to branch -D', async () => {
    succeedWith()
    await removeWorktree(REPO, SESSION_ID)
    const [, secondArgs] = mockExecFile.mock.calls[1] as [string, string[], Cb]
    expect(secondArgs).toContain(BRANCH)
  })

  it('passes exact worktree path to worktree remove', async () => {
    succeedWith()
    await removeWorktree(REPO, SESSION_ID)
    const [, firstArgs] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(firstArgs).toContain(WT_PATH)
  })
})

// ── pruneWorktrees — exact args ────────────────────────────────────────────────

describe('pruneWorktrees — exact git args (StringLiteral)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses "prune" subcommand (not empty)', async () => {
    succeedWith()
    await pruneWorktrees(REPO)
    const [, args] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(args).toContain('prune')
    expect(args).not.toContain('')
  })

  it('passes -C and repo root', async () => {
    succeedWith()
    await pruneWorktrees(REPO)
    const [, args] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(args[0]).toBe('-C')
    expect(args[1]).toBe(REPO)
  })
})

// ── removeWorktreeByPath — porcelain parsing (StringLiteral / MethodExpression / Regex) ──

describe('removeWorktreeByPath — porcelain parsing', () => {
  const TARGET = path.resolve('/fake/worktrees/my-wt')

  beforeEach(() => vi.clearAllMocks())

  function buildPorcelain(entries: Array<{ path: string; branch: string }>) {
    return entries
      .map(e => `worktree ${e.path}\nHEAD abc\nbranch refs/heads/${e.branch}`)
      .join('\n\n') + '\n\n'
  }

  it('strips refs/heads/ prefix from branch name (Regex: ^refs/heads/)', async () => {
    const output = buildPorcelain([{ path: TARGET, branch: 'agent/foo/s123' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await removeWorktreeByPath(REPO, TARGET)
    const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], Cb]
    // Must be stripped, not 'refs/heads/agent/foo/s123'
    expect(branchArgs).toContain('agent/foo/s123')
    expect(branchArgs).not.toContain('refs/heads/')
  })

  it('resolves target path before comparison (MethodExpression)', async () => {
    // Pass a path that needs resolving
    const rawPath = '/fake/worktrees/my-wt'
    const output = buildPorcelain([{ path: rawPath, branch: 'agent/test' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await removeWorktreeByPath(REPO, rawPath)
    // Should find and delete branch
    expect(mockExecFile).toHaveBeenCalledTimes(3)
    const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], Cb]
    expect(branchArgs).toContain('agent/test')
  })

  it('parses blocks separated by multiple blank lines (Regex: /\\n\\n+/)', async () => {
    // Double blank line separator
    const output = `worktree /other/path\nHEAD abc\nbranch refs/heads/main\n\n\nworktree ${TARGET}\nHEAD def\nbranch refs/heads/agent/double\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await removeWorktreeByPath(REPO, TARGET)
    expect(mockExecFile).toHaveBeenCalledTimes(3)
    const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], Cb]
    expect(branchArgs).toContain('agent/double')
  })

  it('trims trailing whitespace from worktree path line (MethodExpression)', async () => {
    const output = `worktree ${TARGET}  \nHEAD abc\nbranch refs/heads/agent/trim-test\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await removeWorktreeByPath(REPO, TARGET)
    expect(mockExecFile).toHaveBeenCalledTimes(3)
  })

  it('skips entry when branchLine is missing (ConditionalExpression both required)', async () => {
    const output = `worktree ${TARGET}\nHEAD abc\ndetached\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await removeWorktreeByPath(REPO, TARGET)
    // list + worktree remove only (no branch -D)
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })

  it('uses "list" subcommand with "--porcelain" flag', async () => {
    succeedWith()
    await removeWorktreeByPath(REPO, TARGET)
    const [, listArgs] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(listArgs).toContain('list')
    expect(listArgs).toContain('--porcelain')
  })

  it('passes "worktree" and "remove" with "--force" to second call', async () => {
    succeedWith()
    await removeWorktreeByPath(REPO, TARGET)
    const [, removeArgs] = mockExecFile.mock.calls[1] as [string, string[], Cb]
    expect(removeArgs).toContain('worktree')
    expect(removeArgs).toContain('remove')
    expect(removeArgs).toContain('--force')
  })

  it('passes "branch" and "-D" to third call when branch found', async () => {
    const output = buildPorcelain([{ path: TARGET, branch: 'agent/exact-branch' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await removeWorktreeByPath(REPO, TARGET)
    const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], Cb]
    expect(branchArgs).toContain('branch')
    expect(branchArgs).toContain('-D')
    expect(branchArgs).toContain('agent/exact-branch')
  })

  it('LogicalOperator: does not match when only worktreeLine matches (no branch line)', async () => {
    // Only worktree line present, no branch line
    const output = `worktree ${TARGET}\nHEAD abc\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await removeWorktreeByPath(REPO, TARGET)
    // No branch -D since no branch found
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })
})

// ── pruneOrphanedWorktrees — parsing and conditionals ─────────────────────────

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
    mockQueryLive.mockResolvedValueOnce([{ ended_at: '2024-01-01', status: 'completed' }])
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
    mockQueryLive.mockResolvedValueOnce([{ ended_at: null, status: 'started' }])
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
    mockQueryLive.mockResolvedValueOnce([{ ended_at: null, status: 'in_progress' }])
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
    mockQueryLive.mockResolvedValueOnce([{ ended_at: '2024-06-01 10:00:00', status: 'in_progress' }])
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
    mockQueryLive.mockResolvedValueOnce([{ ended_at: null, status: 'completed' }])
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

describe('parseWorktreeList — internal parser behavior (MethodExpression/Regex)', () => {
  const DB_PATH = '/fake/db'

  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryLive.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('trims output before splitting (MethodExpression .trim())', async () => {
    // Output with leading/trailing whitespace
    const output = `\n\nworktree /fake/wt/trim-test\nHEAD abc\nbranch refs/heads/main\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    // Should not throw; main branch is skipped since not agent/
    await expect(pruneOrphanedWorktrees(REPO, DB_PATH)).resolves.toBeUndefined()
  })

  it('splits on /\\n\\n+/ (Regex) not just /\\n\\n/', async () => {
    // Three blank lines between blocks
    const ts = 1700000099999
    vi.spyOn(Date, 'now').mockReturnValue(ts + 4 * 60 * 60 * 1000 + 1)
    const output = `worktree /other\nHEAD abc\nbranch refs/heads/main\n\n\n\nworktree /fake/wt/split-test\nHEAD def\nbranch refs/heads/agent/x/s${ts}\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // Should still detect the second block: list + remove + branch-D + prune
    expect(mockExecFile).toHaveBeenCalledTimes(4)
  })

  it('filters out entries with empty path (ConditionalExpression line 142: wt.path !== "")', async () => {
    // Block with no worktree line → path becomes ''
    const ts = 1700000099998
    vi.spyOn(Date, 'now').mockReturnValue(ts + 4 * 60 * 60 * 1000 + 1)
    const output = `HEAD abc\nbranch refs/heads/agent/dev/s${ts}\n\nworktree /fake/wt/valid\nHEAD def\nbranch refs/heads/main\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // The first block has no worktree line → filtered → only main branch processed → list + prune
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })

  it('uses "worktree " prefix (with space) to find path line (StringLiteral)', async () => {
    // If prefix were empty or different, parser would break
    const ts = 1700000088888
    vi.spyOn(Date, 'now').mockReturnValue(ts + 4 * 60 * 60 * 1000 + 1)
    // Correct format: "worktree <path>"
    const output = `worktree /fake/wt/prefix-test\nHEAD abc\nbranch refs/heads/agent/x/s${ts}\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // Stale → removed: list + remove + branch-D + prune
    expect(mockExecFile).toHaveBeenCalledTimes(4)
  })

  it('uses "branch " prefix (with space) to find branch line (StringLiteral)', async () => {
    // If prefix were empty or different, parser would break and branch = null
    const ts = 1700000077777
    vi.spyOn(Date, 'now').mockReturnValue(ts + 4 * 60 * 60 * 1000 + 1)
    const output = `worktree /fake/wt/branch-prefix-test\nHEAD abc\nbranch refs/heads/agent/x/s${ts}\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // Branch found → stale → removed: list + remove + branch-D + prune
    expect(mockExecFile).toHaveBeenCalledTimes(4)
    const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], Cb]
    expect(branchArgs).toContain(`agent/x/s${ts}`)
  })

  it('ArrayDeclaration (line 163): porcelain args are non-empty array (not [])', async () => {
    const output = `worktree ${REPO}\nHEAD abc\nbranch refs/heads/main\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    const [, listArgs] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(listArgs.length).toBeGreaterThan(0)
    expect(listArgs).toEqual(['-C', REPO, 'worktree', 'list', '--porcelain'])
  })
})
