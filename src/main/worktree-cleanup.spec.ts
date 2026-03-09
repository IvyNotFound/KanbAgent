/**
 * Unit tests for worktree-cleanup.ts
 * Covers cleanupOrphanWorktreesAtStartup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── db mock ───────────────────────────────────────────────────────────────────

const mockGetAllowedProjectPaths = vi.hoisted(() => vi.fn<() => string[]>())

vi.mock('./db', () => ({
  getAllowedProjectPaths: mockGetAllowedProjectPaths,
}))

// ── worktree-manager mock ─────────────────────────────────────────────────────

const mockPruneOrphanedWorktrees = vi.hoisted(() => vi.fn<() => Promise<void>>())

vi.mock('./worktree-manager', () => ({
  pruneOrphanedWorktrees: mockPruneOrphanedWorktrees,
}))

// ── fs/promises mock ──────────────────────────────────────────────────────────

const mockAccess = vi.hoisted(() => vi.fn<() => Promise<void>>())

vi.mock('fs/promises', () => ({
  default: { access: mockAccess },
  access: mockAccess,
}))

import { cleanupOrphanWorktreesAtStartup } from './worktree-cleanup'
import path from 'path'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cleanupOrphanWorktreesAtStartup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls pruneOrphanedWorktrees for each project with a valid DB', async () => {
    mockGetAllowedProjectPaths.mockReturnValue(['/proj/a', '/proj/b'])
    mockAccess.mockResolvedValue(undefined)
    mockPruneOrphanedWorktrees.mockResolvedValue(undefined)

    await cleanupOrphanWorktreesAtStartup()

    expect(mockPruneOrphanedWorktrees).toHaveBeenCalledTimes(2)
    expect(mockPruneOrphanedWorktrees).toHaveBeenCalledWith(
      '/proj/a',
      path.join('/proj/a', '.claude', 'project.db')
    )
    expect(mockPruneOrphanedWorktrees).toHaveBeenCalledWith(
      '/proj/b',
      path.join('/proj/b', '.claude', 'project.db')
    )
  })

  it('skips project when DB is not accessible', async () => {
    mockGetAllowedProjectPaths.mockReturnValue(['/proj/no-db'])
    mockAccess.mockRejectedValue(new Error('ENOENT'))

    await cleanupOrphanWorktreesAtStartup()

    expect(mockPruneOrphanedWorktrees).not.toHaveBeenCalled()
  })

  it('does nothing when no project paths are registered', async () => {
    mockGetAllowedProjectPaths.mockReturnValue([])

    await cleanupOrphanWorktreesAtStartup()

    expect(mockAccess).not.toHaveBeenCalled()
    expect(mockPruneOrphanedWorktrees).not.toHaveBeenCalled()
  })

  it('continues to next project when pruneOrphanedWorktrees throws', async () => {
    mockGetAllowedProjectPaths.mockReturnValue(['/proj/fail', '/proj/ok'])
    mockAccess.mockResolvedValue(undefined)
    mockPruneOrphanedWorktrees
      .mockRejectedValueOnce(new Error('git error'))
      .mockResolvedValueOnce(undefined)

    await expect(cleanupOrphanWorktreesAtStartup()).resolves.toBeUndefined()
    expect(mockPruneOrphanedWorktrees).toHaveBeenCalledTimes(2)
  })
})
