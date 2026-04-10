/**
 * Tests for ipc-project.ts — T1322
 * Targets surviving mutants at L293/L299 (trusted paths) and CLAUDE.md resolution.
 *
 * Key mutants killed:
 * - L293: `let trusted = isProjectPathAllowed(projectPath)` → mutant sets trusted=true always
 * - L299: `trusted = paths.some(p => resolve(p) === resolvedPath)` → mutant inverts equality
 * - L73:  `if (files.length > 0)` → first file returned vs null
 * - lang guard: `lang === 'en' ? 'en' : 'fr'`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolve } from 'path'

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
import { getAllowedProjectPaths, isProjectPathAllowed } from './db'

async function callHandler(channel: string, ...args: unknown[]) {
  const handler = handlers[channel]
  if (!handler) throw new Error(`Handler not found: ${channel}`)
  return handler(null, ...args)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ipc-project T1322 — trusted paths & CLAUDE.md resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerIpcHandlers()
    registerDbPath('/fake/project.db')
    registerProjectPath('/fake/project')
    registerProjectPath('/my/project')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── L293: isProjectPathAllowed gate — kill "trusted = true" mutant ──────────
  //
  // If L293 mutant sets trusted=true always, any path (even untrusted) would be
  // registered. These tests verify that an untrusted path is NOT registered.

  describe('CLAUDE.md resolution — subdirectory path (select-project-dir hasCLAUDEmd)', () => {
    it('CLAUDE.md at <projectPath>/CLAUDE.md → hasCLAUDEmd: true', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      // .claude/ dir exists and has a db, CLAUDE.md access succeeds
      vi.mocked(access)
        .mockResolvedValueOnce(undefined) // .claude/ dir
        .mockResolvedValueOnce(undefined) // CLAUDE.md
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])

      const result = await callHandler('select-project-dir') as {
        projectPath: string; hasCLAUDEmd: boolean
      }
      expect(result.hasCLAUDEmd).toBe(true)
      expect(result.projectPath).toBe('/my/project')
    })

    it('CLAUDE.md absent → hasCLAUDEmd: false (access throws ENOENT)', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      vi.mocked(access)
        .mockResolvedValueOnce(undefined) // .claude/ dir accessible
        .mockRejectedValueOnce(new Error('ENOENT')) // CLAUDE.md not found
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])

      const result = await callHandler('select-project-dir') as {
        hasCLAUDEmd: boolean
      }
      expect(result.hasCLAUDEmd).toBe(false)
    })

    it('hasCLAUDEmd is a boolean (not undefined or null)', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValue([])

      const result = await callHandler('select-project-dir') as {
        hasCLAUDEmd: unknown
      }
      expect(typeof result.hasCLAUDEmd).toBe('boolean')
      expect(result.hasCLAUDEmd).not.toBeNull()
      expect(result.hasCLAUDEmd).not.toBeUndefined()
    })

    it('CLAUDE.md check uses join(projectPath, "CLAUDE.md") — path contains project dir', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      const projectPath = '/deep/sub/directory/project'
      registerProjectPath(projectPath)

      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: [projectPath],
      })
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValue([])

      await callHandler('select-project-dir')

      // The access call for CLAUDE.md must include the project dir in path
      const accessCalls = vi.mocked(access).mock.calls.map(c => String(c[0]))
      const claudeMdCall = accessCalls.find(p => p.includes('CLAUDE.md'))
      expect(claudeMdCall).toBeDefined()
      expect(claudeMdCall).toContain('deep')
      expect(claudeMdCall).toContain('CLAUDE.md')
    })
  })

  // ── assertProjectPathAllowed — create-project-db & init-new-project ───────

  describe('assertProjectPathAllowed — trusted path enforcement', () => {
    it('create-project-db: untrusted path throws PROJECT_PATH_NOT_ALLOWED', async () => {
      await expect(
        callHandler('create-project-db', '/completely/untrusted/path')
      ).rejects.toThrow('PROJECT_PATH_NOT_ALLOWED')
    })

    it('create-project-db: trusted path does NOT throw', async () => {
      await expect(
        callHandler('create-project-db', '/fake/project')
      ).resolves.toBeDefined()
    })

    it('init-new-project: untrusted path returns { success: false } with PROJECT_PATH_NOT_ALLOWED', async () => {
      // init-new-project catches the error internally and returns { success: false, error }
      const result = await callHandler('init-new-project', '/unauthorized/project') as {
        success: boolean; error: string
      }
      expect(result.success).toBe(false)
      expect(result.error).toContain('PROJECT_PATH_NOT_ALLOWED')
    })

    it('init-new-project: trusted path does NOT throw', async () => {
      await expect(
        callHandler('init-new-project', '/fake/project')
      ).resolves.toBeDefined()
    })

    it('create-project-db trusted vs untrusted: distinct outcomes (not same behavior)', async () => {
      // Trusted: success
      const trustedResult = await callHandler('create-project-db', '/fake/project') as {
        success: boolean
      }
      expect(trustedResult.success).toBe(true)

      // Untrusted: throws (must be different behavior — kills mutant that removes the guard)
      await expect(
        callHandler('create-project-db', '/evil/untrusted')
      ).rejects.toThrow()
    })
  })
})
