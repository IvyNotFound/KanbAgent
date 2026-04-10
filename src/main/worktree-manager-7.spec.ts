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
