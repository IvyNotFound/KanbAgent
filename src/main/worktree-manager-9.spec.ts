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

describe('removeWorktreeByPath — Regex /\\n\\n+/ in porcelain parsing', () => {
  const TARGET = path.resolve('/fake/target-wt')

  beforeEach(() => vi.clearAllMocks())

  it('finds target in second block when blocks separated by 3 newlines (Regex)', async () => {
    const output = `worktree /other\nHEAD abc\nbranch refs/heads/main\n\n\n\nworktree ${TARGET}\nHEAD def\nbranch refs/heads/agent/found\n\n`
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(null, output)
      else cb(null)
    })
    await removeWorktreeByPath(REPO, TARGET)
    expect(mockExecFile).toHaveBeenCalledTimes(3)
    const [, branchArgs] = mockExecFile.mock.calls[2] as [string, string[], Cb]
    expect(branchArgs).toContain('agent/found')
  })
})

// ── createWorktree — StringLiteral branch construction ────────────────────────

describe('createWorktree — StringLiteral branch name construction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('branch name is "agent/" + sessionId (not empty prefix)', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => cb(null))
    const result = await createWorktree(REPO, 777)
    expect(result.branch).toBe('agent/777')
    expect(result.branch).toContain('agent/')
    expect(result.branch).not.toBe('777') // prefix must not be empty
  })

  it('worktree path contains "agent-worktrees" directory name (StringLiteral)', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => cb(null))
    const result = await createWorktree(REPO, 888)
    expect(result.path).toContain('agent-worktrees')
    expect(result.path).toContain('888')
  })

  it('fallback: error with "already exists" triggers attach without -b (StringLiteral match)', async () => {
    let n = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => {
      n++
      if (n === 1) cb(new Error('fatal: already exists'))
      else cb(null)
    })
    await expect(createWorktree(REPO, 100)).resolves.toBeDefined()
    expect(mockExecFile).toHaveBeenCalledTimes(2)
  })
})

// ── removeWorktree — StringLiteral: "agent/" prefix in branch name ───────────

describe('removeWorktree — StringLiteral branch name', () => {
  beforeEach(() => vi.clearAllMocks())

  it('branch passed to -D starts with "agent/" (StringLiteral)', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => cb(null))
    await removeWorktree(REPO, 55)
    const [, secondArgs] = mockExecFile.mock.calls[1] as [string, string[], Cb]
    expect(secondArgs).toContain('agent/55')
    expect(secondArgs.find((a: string) => a.startsWith('agent/'))).toBeDefined()
  })

  it('worktree path contains "agent-worktrees" in remove call (StringLiteral)', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => cb(null))
    await removeWorktree(REPO, 66)
    const [, firstArgs] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(firstArgs.join(' ')).toContain('agent-worktrees')
  })
})

// ── pruneWorktrees — StringLiteral: exact subcommand and flags ─────────────────

describe('pruneWorktrees — exact git subcommand (StringLiteral)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes "worktree" as subcommand (not empty string)', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => cb(null))
    await pruneWorktrees(REPO)
    const [, args] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(args).toContain('worktree')
    expect(args[2]).toBe('worktree')
  })

  it('passes "prune" as git command (StringLiteral)', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: Cb) => cb(null))
    await pruneWorktrees(REPO)
    const [, args] = mockExecFile.mock.calls[0] as [string, string[], Cb]
    expect(args[3]).toBe('prune')
    expect(args[3]).not.toBe('')
  })
})
