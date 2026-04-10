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
