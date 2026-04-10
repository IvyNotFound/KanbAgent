/**
 * Tests for copyWorktreeConfigs and WORKTREE_CONFIG_FILES (T1920).
 *
 * Verifies that non-git-tracked CLI config files are copied from the main repo
 * into worktrees at creation time.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'

// ── fs/promises mock ─────────────────────────────────────────────────────────

const mockCopyFile = vi.hoisted(() => vi.fn())
const mockMkdir = vi.hoisted(() => vi.fn())

vi.mock('fs/promises', () => ({
  default: {
    copyFile: (...args: unknown[]) => mockCopyFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
  },
  copyFile: (...args: unknown[]) => mockCopyFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}))

// ── child_process mock (required by worktree-manager imports) ────────────────

vi.mock('child_process', () => ({
  default: { execFile: vi.fn() },
  execFile: vi.fn(),
}))

// ── db mock ──────────────────────────────────────────────────────────────────

vi.mock('./db', () => ({
  queryLive: vi.fn(),
}))

import { copyWorktreeConfigs, WORKTREE_CONFIG_FILES } from './worktree-manager'

const REPO = '/fake/project'
const WT_PATH = '/fake/agent-worktrees/42'

describe('WORKTREE_CONFIG_FILES', () => {
  it('has entries for claude with settings files', () => {
    expect(WORKTREE_CONFIG_FILES.claude).toEqual([
      '.claude/settings.json',
      '.claude/settings.local.json',
    ])
  })

  it('has empty arrays for git-tracked CLIs', () => {
    expect(WORKTREE_CONFIG_FILES.gemini).toEqual([])
    expect(WORKTREE_CONFIG_FILES.codex).toEqual([])
    expect(WORKTREE_CONFIG_FILES.aider).toEqual([])
    expect(WORKTREE_CONFIG_FILES.goose).toEqual([])
    expect(WORKTREE_CONFIG_FILES.opencode).toEqual([])
  })
})

describe('copyWorktreeConfigs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCopyFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
  })

  it('copies claude settings files by default', async () => {
    await copyWorktreeConfigs(REPO, WT_PATH)

    expect(mockMkdir).toHaveBeenCalledTimes(2)
    expect(mockCopyFile).toHaveBeenCalledTimes(2)

    expect(mockCopyFile).toHaveBeenCalledWith(
      path.join(REPO, '.claude/settings.json'),
      path.join(WT_PATH, '.claude/settings.json'),
    )
    expect(mockCopyFile).toHaveBeenCalledWith(
      path.join(REPO, '.claude/settings.local.json'),
      path.join(WT_PATH, '.claude/settings.local.json'),
    )
  })

  it('creates target directory before copying', async () => {
    await copyWorktreeConfigs(REPO, WT_PATH)

    expect(mockMkdir).toHaveBeenCalledWith(
      path.dirname(path.join(WT_PATH, '.claude/settings.json')),
      { recursive: true },
    )
  })

  it('skips silently when source file is missing', async () => {
    mockCopyFile.mockRejectedValue(new Error('ENOENT: no such file'))

    await expect(copyWorktreeConfigs(REPO, WT_PATH)).resolves.toBeUndefined()
    expect(mockCopyFile).toHaveBeenCalledTimes(2)
  })

  it('skips silently when mkdir fails', async () => {
    mockMkdir.mockRejectedValue(new Error('EPERM'))

    await expect(copyWorktreeConfigs(REPO, WT_PATH)).resolves.toBeUndefined()
  })

  it('does nothing for CLIs with no config files', async () => {
    await copyWorktreeConfigs(REPO, WT_PATH, ['gemini'])

    expect(mockCopyFile).not.toHaveBeenCalled()
    expect(mockMkdir).not.toHaveBeenCalled()
  })

  it('copies files for multiple CLI types without duplicates', async () => {
    await copyWorktreeConfigs(REPO, WT_PATH, ['claude', 'claude', 'gemini'])

    // Deduplication: claude files copied once, gemini has none
    expect(mockCopyFile).toHaveBeenCalledTimes(2)
  })

  it('handles empty cliTypes array gracefully', async () => {
    await copyWorktreeConfigs(REPO, WT_PATH, [])

    expect(mockCopyFile).not.toHaveBeenCalled()
  })

  it('continues copying remaining files when one fails', async () => {
    // First copyFile fails, second succeeds
    mockCopyFile
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(undefined)

    await expect(copyWorktreeConfigs(REPO, WT_PATH)).resolves.toBeUndefined()
    expect(mockCopyFile).toHaveBeenCalledTimes(2)
  })
})
