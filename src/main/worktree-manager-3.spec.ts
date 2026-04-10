/**
 * Targeted tests to kill remaining surviving mutants in worktree-manager.ts (T1273).
 *
 * Focuses on:
 * - parseWorktreeList internal behavior (StringLiteral prefixes, Regex, MethodExpression)
 * - pruneOrphanedWorktrees string formatting (StringLiteral: 'agent/', template literals)
 * - BlockStatement: console.log side effects verifiable via spy
 * - removeWorktreeByPath additional edge cases
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
  parseWorktreeList,
  removeWorktreeByPath,
  pruneOrphanedWorktrees,
  createWorktree,
  removeWorktree,
  pruneWorktrees,
} from './worktree-manager'

type Cb = (err: Error | null, stdout?: string, stderr?: string) => void

const REPO = '/repo-test'

function succeedWith(stdout = '') {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => cb(null, stdout))
}

// ── parseWorktreeList — StringLiteral prefix tests ────────────────────────────

describe('parseWorktreeList — StringLiteral prefix exactness', () => {
  it('uses "worktree " (with trailing space) prefix — "worktree/path" without space is ignored', () => {
    // If the prefix is empty or "worktree" without space, any line would match
    const output = `worktree /correct-path\nHEAD abc\nbranch refs/heads/main\n\n`
    const result = parseWorktreeList(output)
    expect(result[0].path).toBe('/correct-path')
    // Must be '/correct-path', not 'worktree /correct-path'
    expect(result[0].path).not.toContain('worktree ')
  })

  it('"worktree" without space does NOT match path lines', () => {
    // A line starting with "worktrees" (no space) should not be parsed as a worktree path
    const output = `worktree /valid\nHEAD abc\nworktrees-not-a-path-line\nbranch refs/heads/main\n\n`
    const result = parseWorktreeList(output)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('/valid')
  })

  it('uses "branch " (with trailing space) prefix — extracts correct value', () => {
    const output = `worktree /path\nHEAD abc\nbranch refs/heads/my-branch\n\n`
    const result = parseWorktreeList(output)
    expect(result[0].branch).toBe('refs/heads/my-branch')
    // Must not include "branch " prefix
    expect(result[0].branch).not.toMatch(/^branch /)
  })

  it('"branch" without space does NOT match branch lines', () => {
    // Line starting with "branches" should not be parsed as a branch
    const output = `worktree /path\nHEAD abc\nbranches-not-a-branch\n\n`
    const result = parseWorktreeList(output)
    expect(result[0].branch).toBeNull()
  })

  it('slice uses correct offset length for "worktree " (9 chars)', () => {
    const output = `worktree /my/exact/path\nHEAD abc\nbranch refs/heads/main\n\n`
    const result = parseWorktreeList(output)
    // 'worktree '.length === 9
    expect(result[0].path).toBe('/my/exact/path')
  })

  it('slice uses correct offset length for "branch " (7 chars)', () => {
    const output = `worktree /path\nHEAD abc\nbranch refs/heads/my-exact-branch\n\n`
    const result = parseWorktreeList(output)
    // 'branch '.length === 7
    expect(result[0].branch).toBe('refs/heads/my-exact-branch')
  })

  it('returns null (not empty string) when branch line missing (MethodExpression ?. ?? null)', () => {
    const output = `worktree /path\nHEAD abc\ndetached\n\n`
    const result = parseWorktreeList(output)
    expect(result[0].branch).toBeNull()
    expect(result[0].branch).not.toBe('')
  })

  it('returns empty string (not null) for missing worktree line — then filtered (MethodExpression ?? "")', () => {
    // Block with no worktree line: path becomes '' → filtered by .filter(wt => wt.path !== '')
    const output = `HEAD abc\nbranch refs/heads/some-branch\n\n`
    const result = parseWorktreeList(output)
    // Filtered out → empty array
    expect(result).toHaveLength(0)
  })
})

// ── parseWorktreeList — Regex \n\n+ ──────────────────────────────────────────

describe('parseWorktreeList — Regex /\\n\\n+/ block splitting', () => {
  it('splits blocks separated by exactly 2 newlines (\\n\\n)', () => {
    const output = [
      'worktree /first',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /second',
      'HEAD bbb',
      'branch refs/heads/feat',
      '',
    ].join('\n')

    const result = parseWorktreeList(output)
    expect(result).toHaveLength(2)
    expect(result[0].path).toBe('/first')
    expect(result[1].path).toBe('/second')
  })

  it('splits blocks separated by 3+ newlines (\\n\\n+)', () => {
    const output = 'worktree /first\nHEAD aaa\nbranch refs/heads/main\n\n\n\nworktree /second\nHEAD bbb\nbranch refs/heads/feat\n\n'
    const result = parseWorktreeList(output)
    expect(result).toHaveLength(2)
    expect(result[0].path).toBe('/first')
    expect(result[1].path).toBe('/second')
  })

  it('single block with no separating newline is treated as 1 entry', () => {
    const output = `worktree /single\nHEAD abc\nbranch refs/heads/main\n`
    const result = parseWorktreeList(output)
    expect(result).toHaveLength(1)
  })

  it('empty string returns empty array (trim + split)', () => {
    const result = parseWorktreeList('')
    expect(result).toHaveLength(0)
  })

  it('whitespace-only string returns empty array (filter)', () => {
    const result = parseWorktreeList('   \n\n   ')
    expect(result).toHaveLength(0)
  })
})

// ── pruneOrphanedWorktrees — BlockStatement console.log calls ─────────────────

describe('pruneOrphanedWorktrees — BlockStatement (console.log/warn side effects)', () => {
  const DB_PATH = '/db-path/project.db'

  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryLive.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs removal of orphaned old-format worktree (BlockStatement console.log)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const output = `worktree /fake/wt/99\nHEAD abc\nbranch refs/heads/agent/99\n\n`
    mockQueryLive.mockResolvedValueOnce([{ id: 99, ended_at: '2024-01-01', status: 'completed' }])
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // console.log must have been called (BlockStatement not {})
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('pruneOrphanedWorktrees')
    )
    const logMsg = consoleSpy.mock.calls[0][0] as string
    expect(logMsg).toContain('99')
  })

  it('logs removal of stale new-format worktree (BlockStatement console.log)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
    const ts = 1700000000000
    vi.spyOn(Date, 'now').mockReturnValue(ts + FOUR_HOURS_MS + 1)
    const output = `worktree /fake/wt/review-s${ts}\nHEAD abc\nbranch refs/heads/agent/review/s${ts}\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('pruneOrphanedWorktrees')
    )
    const logMsg = consoleSpy.mock.calls[0][0] as string
    expect(logMsg).toContain('review')
  })

  it('warns when git worktree list fails (BlockStatement console.warn)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      cb(new Error('not a git repo'))
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pruneOrphanedWorktrees'),
      expect.anything()
    )
  })

  it('warns when DB query fails for a session (BlockStatement console.warn)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const output = `worktree /fake/wt/42\nHEAD abc\nbranch refs/heads/agent/42\n\n`
    mockQueryLive.mockRejectedValueOnce(new Error('DB locked'))
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pruneOrphanedWorktrees'),
      expect.anything()
    )
  })
})

// ── pruneOrphanedWorktrees — StringLiteral in branch formatting ───────────────

describe('pruneOrphanedWorktrees — StringLiteral in branch/session formatting', () => {
  const DB_PATH = '/db/proj.db'

  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryLive.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('branch name for new-format uses "agent/" prefix (StringLiteral)', async () => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
    const ts = 1700001234567
    vi.spyOn(Date, 'now').mockReturnValue(ts + FOUR_HOURS_MS + 1)
    const output = `worktree /wt/test\nHEAD abc\nbranch refs/heads/agent/myname/s${ts}\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], Cb]
    // Branch must be "agent/myname/s<ts>" not "myname/s<ts>" or empty
    expect(branchArgs).toContain(`agent/myname/s${ts}`)
    expect(branchArgs.find((a: string) => a.startsWith('agent/'))).toBeDefined()
  })

  it('branch name includes "/" separator between name and "s" prefix (StringLiteral)', async () => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
    const ts = 1700009876543
    vi.spyOn(Date, 'now').mockReturnValue(ts + FOUR_HOURS_MS + 1)
    const output = `worktree /wt/test2\nHEAD abc\nbranch refs/heads/agent/bot/s${ts}\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], Cb]
    const fullBranch = `agent/bot/s${ts}`
    expect(branchArgs).toContain(fullBranch)
    // Must contain both slashes
    expect(fullBranch.split('/').length).toBe(3)
  })

  it('uses wt.path (not empty) in worktree remove call (StringLiteral)', async () => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
    const ts = 1700000555444
    vi.spyOn(Date, 'now').mockReturnValue(ts + FOUR_HOURS_MS + 1)
    const wtPath = `/wt/stale-path-${ts}`
    const output = `worktree ${wtPath}\nHEAD abc\nbranch refs/heads/agent/x/s${ts}\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    const [, removeArgs] = mockExecFile.mock.calls[1] as [string, string[], Cb]
    expect(removeArgs).toContain(wtPath)
    expect(removeArgs).not.toContain('')
  })
})

// ── pruneOrphanedWorktrees — Regex for new-format branches ───────────────────

describe('pruneOrphanedWorktrees — Regex anchors for new-format branches', () => {
  const DB_PATH = '/db/proj.db'

  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryLive.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('new-format regex requires "s" followed by digits only (Regex)', async () => {
    // branch like "agent/bot/s123abc" should NOT match (non-digit after s)
    const output = `worktree /wt/x\nHEAD abc\nbranch refs/heads/agent/bot/s123abc\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // Should NOT have triggered removal (no match) → list + prune only
    expect(mockExecFile).toHaveBeenCalledTimes(2)
    expect(mockQueryLive).not.toHaveBeenCalled()
  })

  it('new-format regex requires at least 1 digit after s (Regex)', async () => {
    // "agent/bot/s" without digits should not match
    const output = `worktree /wt/x\nHEAD abc\nbranch refs/heads/agent/bot/s\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    // No match → list + prune
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })

  it('new-format regex captures name portion correctly (Regex capture group)', async () => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
    const ts = 1700000000001
    vi.spyOn(Date, 'now').mockReturnValue(ts + FOUR_HOURS_MS + 1)
    const output = `worktree /wt/x\nHEAD abc\nbranch refs/heads/agent/dev-back/s${ts}\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await pruneOrphanedWorktrees(REPO, DB_PATH)
    const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], Cb]
    // Name with hyphen is correctly captured
    expect(branchArgs).toContain(`agent/dev-back/s${ts}`)
  })
})

// ── removeWorktreeByPath — Regex /\n\n+/ block splitting ─────────────────────
