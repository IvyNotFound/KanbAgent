/**
 * Tests for git IPC handlers — git:log.
 *
 * Migrated from ipc.spec.ts (T851).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Electron mock ──────────────────────────────────────────────────────────────
const handlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  app: {
    getVersion: vi.fn(() => '0.3.0'),
    isPackaged: false,
    getAppPath: vi.fn(() => '/fake/app'),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn(),
  },
}))

// ── better-sqlite3 mock ─────────────────────────────────────────────────────
vi.mock('better-sqlite3', () => ({
  default: function MockDatabase() {
    return {
      pragma: vi.fn(),
      prepare: vi.fn(() => ({ run: vi.fn(), all: vi.fn(() => []), get: vi.fn() })),
      exec: vi.fn(),
      close: vi.fn(),
    }
  },
}))

// ── fs mock ────────────────────────────────────────────────────────────────────
vi.mock('fs', () => {
  const watch = vi.fn(() => ({ close: vi.fn() }))
  const existsSync = vi.fn(() => false)
  const readdirSync = vi.fn(() => [] as string[])
  const stat = vi.fn((_path: string, cb?: (err: null, stat: { mtimeMs: number }) => void) => {
    if (cb) cb(null, { mtimeMs: 1000 })
    return Promise.resolve({ mtimeMs: 1000 })
  })
  return {
    default: { watch, existsSync, readdirSync, stat },
    watch,
    existsSync,
    readdirSync,
    stat,
  }
})

vi.mock('fs/promises', () => {
  const readFile = vi.fn().mockResolvedValue(Buffer.from('file content', 'utf-8'))
  const writeFile = vi.fn().mockResolvedValue(undefined)
  const mkdir = vi.fn().mockResolvedValue(undefined)
  const rename = vi.fn().mockResolvedValue(undefined)
  const stat = vi.fn().mockResolvedValue({ mtimeMs: 1000 })
  const access = vi.fn().mockResolvedValue(undefined)
  const readdir = vi.fn().mockResolvedValue([] as string[])
  const copyFile = vi.fn().mockResolvedValue(undefined)
  return {
    default: { readFile, writeFile, mkdir, rename, stat, access, readdir, copyFile },
    readFile,
    writeFile,
    mkdir,
    rename,
    stat,
    access,
    readdir,
    copyFile,
  }
})

// ── child_process mock ────────────────────────────────────────────────────────
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}))
vi.mock('child_process', () => ({
  default: { execSync: vi.fn(), execFile: mockExecFile, spawn: vi.fn(() => ({ unref: vi.fn() })) },
  execSync: vi.fn(),
  execFile: mockExecFile,
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))

// ── ./db mock ─────────────────────────────────────────────────────────────────
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    queryLive: vi.fn().mockRejectedValue(new Error('file is not a database')),
  }
})

// ── Import ipc.ts AFTER mocks ─────────────────────────────────────────────────
import { registerIpcHandlers, registerDbPath, registerProjectPath } from './ipc'

// Helper to call a captured handler
async function callHandler(channel: string, ...args: unknown[]) {
  const handler = handlers[channel]
  if (!handler) throw new Error(`Handler not found: ${channel}. Available: ${Object.keys(handlers).join(', ')}`)
  return handler(null, ...args)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('IPC git handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerIpcHandlers()
    registerDbPath('/fake/project.db')
    registerProjectPath('/fake/project')
    mockExecFile.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── git:log ───────────────────────────────────────────────────────────────

  describe('git:log handler (T777)', () => {
    const SEP = '\x1F'

    it('should throw PROJECT_PATH_NOT_ALLOWED for unregistered projectPath', async () => {
      await expect(
        callHandler('git:log', '/unregistered/repo')
      ).rejects.toThrow()
    })

    it('should return [] when execFile errors (git absent or invalid repo)', async () => {
      mockExecFile.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: (err: Error | null, stdout: string) => void) => cb(new Error('git: command not found'), ''))
      const result = await callHandler('git:log', '/fake/project') as unknown[]
      expect(result).toEqual([])
    })

    it('should clamp limit < 1 to 1', async () => {
      mockExecFile.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: (err: null, stdout: string) => void) => cb(null, ''))
      await callHandler('git:log', '/fake/project', { limit: 0 })
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args.join(' ')).toContain('-n 1')
    })

    it('should clamp limit > 500 to 500', async () => {
      mockExecFile.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: (err: null, stdout: string) => void) => cb(null, ''))
      await callHandler('git:log', '/fake/project', { limit: 9999 })
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args.join(' ')).toContain('-n 500')
    })

    it('should floor decimal limit (2.9 → 2)', async () => {
      mockExecFile.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: (err: null, stdout: string) => void) => cb(null, ''))
      await callHandler('git:log', '/fake/project', { limit: 2.9 })
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args.join(' ')).toContain('-n 2')
    })

    it('should inject sinceArg for valid since string', async () => {
      mockExecFile.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: (err: null, stdout: string) => void) => cb(null, ''))
      await callHandler('git:log', '/fake/project', { since: '2024-01-01' })
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args.some((a: string) => a.startsWith('--since='))).toBe(true)
    })

    it('should NOT inject sinceArg for string with semicolon (injection guard)', async () => {
      mockExecFile.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: (err: null, stdout: string) => void) => cb(null, ''))
      await callHandler('git:log', '/fake/project', { since: '2024-01-01; rm -rf /' })
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args.some((a: string) => a.startsWith('--since='))).toBe(false)
    })

    it('should parse hash, date, subject, author from output line', async () => {
      const line = `abc123${SEP}2024-01-15T10:00:00+00:00${SEP}fix: something${SEP}John`
      mockExecFile.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: (err: null, stdout: string) => void) => cb(null, line + '\n'))
      const result = await callHandler('git:log', '/fake/project') as Array<{ hash: string; date: string; subject: string; author: string; taskIds: number[] }>
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ hash: 'abc123', date: '2024-01-15T10:00:00+00:00', subject: 'fix: something', author: 'John', taskIds: [] })
    })

    it('should extract multiple taskIds from subject (T123+T456)', async () => {
      const line = `def456${SEP}2024-01-16T10:00:00+00:00${SEP}feat(scope): do thing (T123 T456)${SEP}Alice`
      mockExecFile.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: (err: null, stdout: string) => void) => cb(null, line + '\n'))
      const result = await callHandler('git:log', '/fake/project') as Array<{ taskIds: number[] }>
      expect(result[0].taskIds).toEqual([123, 456])
    })

    it('should filter empty lines from output', async () => {
      const line = `abc123${SEP}2024-01-15T10:00:00+00:00${SEP}fix: x${SEP}John`
      mockExecFile.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: (err: null, stdout: string) => void) => cb(null, `${line}\n\n\n`))
      const result = await callHandler('git:log', '/fake/project') as unknown[]
      expect(result).toHaveLength(1)
    })
  })

  // ── git:worktree-remove ────────────────────────────────────────────────────

  describe('git:worktree-remove handler (T1205)', () => {
    it('should throw for unregistered projectPath', async () => {
      await expect(
        callHandler('git:worktree-remove', '/unregistered/path', '/some/workdir')
      ).rejects.toThrow()
    })

    it('should return error for empty workDir', async () => {
      const result = await callHandler('git:worktree-remove', '/fake/project', '') as { success: boolean; error?: string }
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid workDir')
    })

    it('should return error for whitespace-only workDir', async () => {
      const result = await callHandler('git:worktree-remove', '/fake/project', '   ') as { success: boolean; error?: string }
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid workDir')
    })

    it('should return { success: true } when removeWorktreeByPath resolves', async () => {
      // list --porcelain returns empty, worktree remove succeeds
      mockExecFile.mockImplementation((_f: unknown, _a: unknown, cb: (err: null, stdout: string) => void) => cb(null, ''))
      const result = await callHandler('git:worktree-remove', '/fake/project', '/fake/project/.claude/worktrees/s123') as { success: boolean }
      expect(result.success).toBe(true)
    })

    it('should still return { success: true } when git worktree remove fails (idempotent)', async () => {
      let callCount = 0
      mockExecFile.mockImplementation((_f: unknown, _a: unknown, cb: (err: Error | null, stdout?: string) => void) => {
        callCount++
        if (callCount === 1) cb(null, '') // list --porcelain: empty
        else cb(new Error('worktree not found'))
      })
      const result = await callHandler('git:worktree-remove', '/fake/project', '/fake/project/.claude/worktrees/s123') as { success: boolean }
      expect(result.success).toBe(true)
    })
  })
})
