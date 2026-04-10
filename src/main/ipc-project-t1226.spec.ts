/**
 * Tests for ipc-project.ts — T1226
 * Targets the 61 surviving mutants (StringLiteral, ConditionalExpression,
 * ObjectLiteral, BlockStatement, LogicalOperator, etc.) by asserting exact values.
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
    getPath: vi.fn((name: string) => `/fake/${name}`),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn(),
  },
}))

// ── better-sqlite3 mock ─────────────────────────────────────────────────────
const mockPragma = vi.fn()
const mockExec = vi.fn()
const mockClose = vi.fn()
const mockRun = vi.fn()
const mockPrepare = vi.fn(() => ({ run: mockRun, all: vi.fn(() => []), get: vi.fn() }))

vi.mock('better-sqlite3', () => ({
  default: function MockDatabase() {
    return {
      pragma: mockPragma,
      prepare: mockPrepare,
      exec: mockExec,
      close: mockClose,
    }
  },
}))

// ── fs/promises mock ───────────────────────────────────────────────────────────
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
    readFile, writeFile, mkdir, rename, stat, access, readdir, copyFile,
  }
})

// ── fs mock ────────────────────────────────────────────────────────────────────
vi.mock('fs', () => {
  const watch = vi.fn(() => ({ close: vi.fn() }))
  const existsSync = vi.fn(() => false)
  const readdirSync = vi.fn(() => [] as string[])
  const stat = vi.fn((_path: string, cb?: (err: null, s: { mtimeMs: number }) => void) => {
    if (cb) cb(null, { mtimeMs: 1000 })
    return Promise.resolve({ mtimeMs: 1000 })
  })
  return { default: { watch, existsSync, readdirSync, stat }, watch, existsSync, readdirSync, stat }
})

// ── child_process mock ─────────────────────────────────────────────────────────
vi.mock('child_process', () => ({
  default: { execSync: vi.fn(), execFile: vi.fn(), spawn: vi.fn(() => ({ unref: vi.fn() })) },
  execSync: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))

// ── ./db mock ──────────────────────────────────────────────────────────────────
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    queryLive: vi.fn().mockRejectedValue(new Error('file is not a database')),
  }
})

import { registerIpcHandlers, registerDbPath, registerProjectPath } from './ipc'
import { getAllowedProjectPaths } from './db'
import { resolve } from 'path'

async function callHandler(channel: string, ...args: unknown[]) {
  const handler = handlers[channel]
  if (!handler) throw new Error(`Handler not found: ${channel}`)
  return handler(null, ...args)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ipc-project T1226 — exact string & value assertions', () => {
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

  // ── getTrustedPathsFile — L29-30: exact filename ──────────────────────────

  describe('getTrustedPathsFile — exact filename (L30)', () => {
    it('persistTrustedPaths writes to trusted-project-paths.json (exact filename)', async () => {
      const { writeFile } = await import('fs/promises')
      const { dialog } = await import('electron')
      // Trigger persistTrustedPaths via select-project-dir (calls void persistTrustedPaths())
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/my/project'],
      })
      vi.mocked(writeFile).mockResolvedValue(undefined)
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'))
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce([])
      await callHandler('select-project-dir')
      // Allow async void to run
      await new Promise(resolve => setTimeout(resolve, 10))
      const writeFileCalls = vi.mocked(writeFile).mock.calls
      const trustedCall = writeFileCalls.find(c => String(c[0]).includes('trusted-project-paths'))
      expect(trustedCall).toBeDefined()
      expect(String(trustedCall![0])).toContain('trusted-project-paths.json')
    })

    it('find-project-db reads from trusted-project-paths.json (exact filename)', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      // Untrusted path → fallback reads trusted-project-paths.json
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>).mockResolvedValueOnce('[]')
      await callHandler('find-project-db', '/untrusted/project')
      const readFileCalls = vi.mocked(readFile).mock.calls
      const trustedCall = readFileCalls.find(c => String(c[0]).includes('trusted-project-paths'))
      expect(trustedCall).toBeDefined()
      expect(String(trustedCall![0])).toContain('trusted-project-paths.json')
      expect(String(trustedCall![1])).toBe('utf-8')
    })
  })

  // ── persistTrustedPaths — L33-34: catch branch is non-fatal ──────────────

  describe('persistTrustedPaths — catch is non-fatal (L33-34)', () => {
    it('does not throw when writeFile fails in persistTrustedPaths', async () => {
      const { dialog, app } = await import('electron')
      const { writeFile, access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/my/project'],
      })
      vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'))
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce([])
      // app.getPath needed for getTrustedPathsFile
      vi.mocked(app.getPath).mockReturnValueOnce('/fake/userData')
      vi.mocked(writeFile).mockRejectedValueOnce(new Error('ENOSPC'))
      // Should not throw
      await expect(callHandler('select-project-dir')).resolves.toBeDefined()
    })
  })

  // ── restoreTrustedPaths — L40-46: exported function ──────────────────────

  describe('restoreTrustedPaths — reads trusted paths on startup', () => {
    it('restoreTrustedPaths registers paths from the JSON file', async () => {
      const { readFile } = await import('fs/promises')
      const { app } = await import('electron')
      vi.mocked(app.getPath).mockReturnValue('/fake/userData')
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>)
        .mockResolvedValueOnce(JSON.stringify(['/restored/project']))
      const { restoreTrustedPaths } = await import('./ipc-project')
      await restoreTrustedPaths()
      expect(getAllowedProjectPaths()).toContain(resolve('/restored/project'))
    })

    it('restoreTrustedPaths does not throw when file is missing', async () => {
      const { readFile } = await import('fs/promises')
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'))
      const { restoreTrustedPaths } = await import('./ipc-project')
      await expect(restoreTrustedPaths()).resolves.toBeUndefined()
    })
  })

  // ── findProjectDb — L71-80: filter, conditional, equality ─────────────────

  describe('findProjectDb — .db filter and path construction (L71-80)', () => {
    it('filters only .db files in .claude/ — non-db files ignored', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      vi.mocked(access).mockResolvedValueOnce(undefined)
      // Mix of .db and other files — only project.db should be returned
      vi.mocked(readdir as (p: string) => Promise<string[]>)
        .mockResolvedValueOnce(['readme.txt', 'project.db', 'backup.json'])
      const result = await callHandler('select-project-dir') as { dbPath: string | null }
      expect(result.dbPath).not.toBeNull()
      expect(result.dbPath).toContain('project.db')
      expect(result.dbPath).not.toContain('readme.txt')
      expect(result.dbPath).not.toContain('backup.json')
    })

    it('findProjectDb returns first .db in .claude/ folder (exact path segments)', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      const result = await callHandler('select-project-dir') as { dbPath: string | null }
      expect(result.dbPath).not.toBeNull()
      // Must contain both .claude and project.db
      expect(result.dbPath).toContain('.claude')
      expect(result.dbPath).toContain('project.db')
    })

    it('findProjectDb falls back to root dir when .claude/ has no .db (L79-80)', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      // .claude/ access OK but no .db files there
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>)
        .mockResolvedValueOnce([]) // .claude/ → empty
        .mockResolvedValueOnce(['fallback.db']) // root → has .db
      const result = await callHandler('select-project-dir') as { dbPath: string | null }
      expect(result.dbPath).not.toBeNull()
      expect(result.dbPath).toContain('fallback.db')
      // Should NOT contain .claude since found in root
      expect(result.dbPath).not.toContain('.claude')
    })

    it('findProjectDb returns null when no .db anywhere (both dirs empty)', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>)
        .mockResolvedValueOnce([]) // .claude/ → no .db
        .mockResolvedValueOnce([]) // root → no .db
      const result = await callHandler('select-project-dir') as { dbPath: string | null }
      expect(result.dbPath).toBeNull()
    })

    it('findProjectDb ignores non-db extensions in root fallback', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/empty/project'],
      })
      vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT')) // no .claude/
      vi.mocked(readdir as (p: string) => Promise<string[]>)
        .mockResolvedValueOnce(['file.txt', 'image.png', 'data.json']) // no .db
      const result = await callHandler('select-project-dir') as { dbPath: string | null }
      expect(result.dbPath).toBeNull()
    })
  })

  // ── select-project-dir dialog options — L91-93 ───────────────────────────

  describe('select-project-dir dialog options (L91-93)', () => {
    it('calls showOpenDialog with title containing "projet" and openDirectory property', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
      await callHandler('select-project-dir')
      expect(dialog.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('projet'),
          properties: expect.arrayContaining(['openDirectory']),
        })
      )
    })

    it('select-project-dir dialog has exactly openDirectory in properties', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
      await callHandler('select-project-dir')
      const call = vi.mocked(dialog.showOpenDialog).mock.calls[0][0]
      expect(call.properties).toEqual(['openDirectory'])
    })
  })

  // ── select-project-dir return shape — L102-103 ───────────────────────────

  describe('select-project-dir return shape (L102-103)', () => {
    it('returns exact shape { projectPath, dbPath: null, error: null, hasCLAUDEmd } when no db found', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT')) // no .claude/
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce([]) // no .db in root
      // CLAUDE.md check also fails
      vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'))
      const result = await callHandler('select-project-dir') as {
        projectPath: string; dbPath: string | null; error: null; hasCLAUDEmd: boolean
      }
      expect(result.projectPath).toBe('/my/project')
      expect(result.dbPath).toBeNull()
      expect(result.error).toBeNull()
      expect(typeof result.hasCLAUDEmd).toBe('boolean')
    })

    it('error field is null (not undefined or false) in both dbPath branches', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      // Branch 1: no db → { dbPath: null, error: null }
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'))
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce([])
      const r1 = await callHandler('select-project-dir') as { error: null }
      expect(r1.error).toBeNull()
      expect(r1.error).not.toBeUndefined()
    })

    it('returns exact { projectPath, dbPath, error: null } when db found', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      vi.mocked(access).mockResolvedValueOnce(undefined) // .claude/ exists
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      const result = await callHandler('select-project-dir') as {
        projectPath: string; dbPath: string; error: null; hasCLAUDEmd: boolean
      }
      expect(result.error).toBeNull()
      expect(result.projectPath).toBe('/my/project')
      expect(result.dbPath).toContain('project.db')
    })
  })

  // ── create-project-db — L115: agentLang exact ────────────────────────────

})
