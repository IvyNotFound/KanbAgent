/**
 * Tests for project-management IPC handlers — select-project-dir,
 * init-new-project, select-new-project-dir, create-project-db, project:exportZip.
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
vi.mock('child_process', () => ({
  default: { execSync: vi.fn(), execFile: vi.fn(), spawn: vi.fn(() => ({ unref: vi.fn() })) },
  execSync: vi.fn(),
  execFile: vi.fn(),
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
import { registerIpcHandlers, registerDbPath, registerProjectPath, AGENT_SCRIPTS } from './ipc'

// Helper to call a captured handler
async function callHandler(channel: string, ...args: unknown[]) {
  const handler = handlers[channel]
  if (!handler) throw new Error(`Handler not found: ${channel}. Available: ${Object.keys(handlers).join(', ')}`)
  return handler(null, ...args)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('IPC project handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerIpcHandlers()
    registerDbPath('/fake/project.db')
    registerProjectPath('/fake/project')
    registerProjectPath('/my/project')
    registerProjectPath('/empty/project')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── select-project-dir ────────────────────────────────────────────────────

  describe('select-project-dir handler', () => {
    it('should return null when dialog is canceled', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
      const result = await callHandler('select-project-dir')
      expect(result).toBeNull()
    })

    it('should return project info when dialog returns a path', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/my/project'] })
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(readdir as (path: string) => Promise<string[]>).mockResolvedValue([])
      const result = await callHandler('select-project-dir') as {
        projectPath: string; dbPath: string | null; error: null; hasCLAUDEmd: boolean
      }
      expect(result).toMatchObject({ projectPath: '/my/project', dbPath: null, error: null })
      expect(result).toHaveProperty('hasCLAUDEmd')
    })

    it('should auto-detect project.db via findProjectDb', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/my/project'] })
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readdir as (path: string) => Promise<string[]>).mockResolvedValue(['project.db'])
      const result = await callHandler('select-project-dir') as {
        projectPath: string; dbPath: string | null
      }
      expect(result.projectPath).toBe('/my/project')
      expect(result.dbPath).toContain('project.db')
    })
  })

  // ── select-project-dir — hasCLAUDEmd ─────────────────────────────────────

  describe('select-project-dir — hasCLAUDEmd', () => {
    it('should return hasCLAUDEmd: true when CLAUDE.md exists', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/my/project'],
      })
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readdir as (path: string) => Promise<string[]>).mockResolvedValue(['project.db'])
      const result = await callHandler('select-project-dir') as {
        projectPath: string; hasCLAUDEmd: boolean
      }
      expect(result.hasCLAUDEmd).toBe(true)
    })

    it('should return hasCLAUDEmd: false when CLAUDE.md does not exist', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/my/project'],
      })
      vi.mocked(access)
        .mockResolvedValueOnce(undefined) // .claude dir exists
        .mockRejectedValueOnce(new Error('ENOENT')) // CLAUDE.md doesn't exist
      vi.mocked(readdir as (path: string) => Promise<string[]>).mockResolvedValue(['project.db'])
      const result = await callHandler('select-project-dir') as {
        projectPath: string; hasCLAUDEmd: boolean
      }
      expect(result.hasCLAUDEmd).toBe(false)
    })
  })

  // ── select-new-project-dir ────────────────────────────────────────────────

  describe('select-new-project-dir handler', () => {
    it('should return null when dialog is canceled', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
      const result = await callHandler('select-new-project-dir')
      expect(result).toBeNull()
    })

    it('should return the selected path when dialog returns a path', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/my/new/project'],
      })
      const result = await callHandler('select-new-project-dir')
      expect(result).toBe('/my/new/project')
    })
  })

  // ── init-new-project ──────────────────────────────────────────────────────

  describe('init-new-project handler', () => {
    it('should return { success: true, filesCreated } on nominal path (default: claude only)', async () => {
      const result = await callHandler('init-new-project', '/fake/project') as {
        success: boolean; filesCreated?: string[]
      }
      expect(result.success).toBe(true)
      expect(result.filesCreated).toEqual(['CLAUDE.md', '.claude/WORKFLOW.md'])
    })

    it('should generate rules for multiple CLIs when projectClis provided', async () => {
      const result = await callHandler('init-new-project', '/fake/project', 'en', ['claude', 'gemini', 'codex'], 'claude') as {
        success: boolean; filesCreated?: string[]
      }
      expect(result.success).toBe(true)
      expect(result.filesCreated).toContain('CLAUDE.md')
      expect(result.filesCreated).toContain('GEMINI.md')
      expect(result.filesCreated).toContain('.codex/instructions.md')
      expect(result.filesCreated).toContain('.claude/WORKFLOW.md')
    })

    it('should return { success: false, error } when writeFile fails', async () => {
      const { writeFile } = await import('fs/promises')
      vi.mocked(writeFile).mockRejectedValueOnce(new Error('ENOSPC: no space left on device'))
      const result = await callHandler('init-new-project', '/fake/project') as { success: boolean; error?: string }
      expect(result.success).toBe(false)
      expect(typeof result.error).toBe('string')
    })

    it('should return { success: false, error } when mkdir fails (EACCES)', async () => {
      const { mkdir } = await import('fs/promises')
      vi.mocked(mkdir).mockRejectedValueOnce(new Error('EACCES: permission denied'))
      const result = await callHandler('init-new-project', '/fake/project') as { success: boolean; error?: string }
      expect(result.success).toBe(false)
      expect(result.error).toContain('EACCES')
    })
  })

})
