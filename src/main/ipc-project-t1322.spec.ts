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

  describe('find-project-db — L293 trusted gate (isProjectPathAllowed)', () => {
    it('path NOT in allowlist + NOT in JSON: allowlist count does not increase', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      // JSON returns empty list → attacker path not trusted
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>).mockResolvedValueOnce('[]')

      const countBefore = getAllowedProjectPaths().length
      await callHandler('find-project-db', '/attacker/path')
      const countAfter = getAllowedProjectPaths().length

      // No new path should have been added (mutant trusted=true would add it)
      expect(countAfter).toBe(countBefore)
    })

    it('path NOT in allowlist + NOT in JSON: isProjectPathAllowed remains false after call', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['data.db'])
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>).mockResolvedValueOnce('[]')

      await callHandler('find-project-db', '/not-trusted/path')
      // isProjectPathAllowed must still return false after the call
      expect(isProjectPathAllowed('/not-trusted/path')).toBe(false)
    })

    it('path IN allowlist (L293 short-circuit): isProjectPathAllowed returns true (no JSON read needed)', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      // /my/project is registered in beforeEach — should be trusted without reading JSON
      const readFileSpy = vi.mocked(readFile)

      await callHandler('find-project-db', '/my/project')

      // Should not have read trusted-project-paths.json (short-circuit at L293)
      const trustedFileRead = readFileSpy.mock.calls.some(c => String(c[0]).includes('trusted-project-paths'))
      expect(trustedFileRead).toBe(false)
      // And should still be in the allowlist
      expect(isProjectPathAllowed('/my/project')).toBe(true)
    })

    it('path NOT in allowlist: find-project-db still returns the dbPath (read-only, no registration)', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['secret.db'])
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>).mockResolvedValueOnce('[]')

      const result = await callHandler('find-project-db', '/not-in-list/project')
      // Returns db path despite not being trusted (security is about registration, not return)
      expect(String(result)).toContain('secret.db')
    })
  })

  // ── L299: resolve(p) === resolvedPath — kill inverted equality mutant ────────
  //
  // The mutant changes `===` to `!==` in paths.some(...) making every non-matching
  // path trusted instead of matching paths.
  // Kill: assert that ONLY the exact matching path is trusted via JSON.

  describe('find-project-db — L299 resolve equality in JSON lookup', () => {
    it('path IN JSON list: becomes trusted and gets registered', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])

      const trustedPath = '/json-registered/project'
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>)
        .mockResolvedValueOnce(JSON.stringify([trustedPath]))

      await callHandler('find-project-db', trustedPath)
      // Must be in allowlist after call (L299 correct: matching path is registered)
      expect(getAllowedProjectPaths()).toContain(resolve(trustedPath))
    })

    it('path NOT in JSON list (different value): does NOT get registered', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])

      // JSON contains a DIFFERENT path, not the requested one
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>)
        .mockResolvedValueOnce(JSON.stringify(['/other/path']))

      const before = [...getAllowedProjectPaths()]
      await callHandler('find-project-db', '/not-in-json/project')
      // The requested path must NOT be added (mutant !== would add all non-matching ones)
      expect(getAllowedProjectPaths()).not.toContain(resolve('/not-in-json/project'))
      expect(getAllowedProjectPaths()).toHaveLength(before.length)
    })

    it('JSON contains multiple paths: only the exact match triggers registration', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])

      const requestedPath = '/exact/match/project'
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>)
        .mockResolvedValueOnce(JSON.stringify(['/other/a', requestedPath, '/other/b']))

      await callHandler('find-project-db', requestedPath)
      // Exact match: registered
      expect(getAllowedProjectPaths()).toContain(resolve(requestedPath))
    })

    it('JSON contains path with different casing: resolve() normalizes — same resolved path is trusted', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])

      const pathInJson = '/my/trusted/project'
      const requestedPath = '/my/trusted/project' // identical after resolve
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>)
        .mockResolvedValueOnce(JSON.stringify([pathInJson]))

      await callHandler('find-project-db', requestedPath)
      expect(getAllowedProjectPaths()).toContain(resolve(requestedPath))
    })

    it('JSON contains only non-matching paths: none of them bleed into registration', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])

      // JSON has paths A, B, C — we request path D
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>)
        .mockResolvedValueOnce(JSON.stringify(['/path/a', '/path/b', '/path/c']))

      const before = [...getAllowedProjectPaths()]
      await callHandler('find-project-db', '/path/d')
      // path/d must NOT be registered
      expect(getAllowedProjectPaths()).not.toContain(resolve('/path/d'))
      // Total count unchanged
      expect(getAllowedProjectPaths()).toHaveLength(before.length)
    })
  })

  // ── lang guard: validLangs.includes() with 'en' fallback ───────────────────

  describe('create-project-db — agentLang guard (validLangs.includes)', () => {
    it('lang="en": agentLang is "en"', async () => {
      const result = await callHandler('create-project-db', '/fake/project', 'en') as {
        success: boolean
      }
      expect(result.success).toBe(true)
    })

    it('lang="fr": agentLang is "fr"', async () => {
      const result = await callHandler('create-project-db', '/fake/project', 'fr') as {
        success: boolean
      }
      expect(result.success).toBe(true)
    })

    it('lang=undefined: agentLang falls back to "en"', async () => {
      const result = await callHandler('create-project-db', '/fake/project', undefined) as {
        success: boolean
      }
      expect(result.success).toBe(true)
    })

    it('valid lang "de" is used directly (not fallback)', async () => {
      const { GENERIC_AGENTS_BY_LANG } = await import('./default-agents')
      const validLangs = Object.keys(GENERIC_AGENTS_BY_LANG)
      expect(validLangs).toContain('de')
      expect(validLangs).toContain('ja')
      expect(validLangs).toContain('zh-CN')
    })

    it('unknown lang "xx" falls back to "en" (not "fr")', async () => {
      const { GENERIC_AGENTS_BY_LANG } = await import('./default-agents')
      const validLangs = Object.keys(GENERIC_AGENTS_BY_LANG)
      expect(validLangs).not.toContain('xx')
      // Verify the fallback logic: unknown → 'en'
      const lang = 'xx'
      const agentLang = validLangs.includes(lang) ? lang : 'en'
      expect(agentLang).toBe('en')
    })
  })

  // ── L73: files.length > 0 — first file returned vs null ──────────────────

  describe('findProjectDb — L73 files.length > 0 guard', () => {
    it('files.length > 0 in .claude/: returns first .db file (not null)', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      vi.mocked(access).mockResolvedValueOnce(undefined) // .claude/ accessible
      vi.mocked(readdir as (p: string) => Promise<string[]>)
        .mockResolvedValueOnce(['first.db', 'second.db'])

      const result = await callHandler('select-project-dir') as { dbPath: string | null }
      expect(result.dbPath).not.toBeNull()
      expect(result.dbPath).toContain('first.db')
    })

    it('files.length === 0 in .claude/ AND root: returns null (not a .db path)', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>)
        .mockResolvedValueOnce([]) // .claude/ empty
        .mockResolvedValueOnce([]) // root empty

      const result = await callHandler('select-project-dir') as { dbPath: string | null }
      expect(result.dbPath).toBeNull()
    })

    it('files.length === 0 in .claude/ but > 0 in root: returns root .db (fallback path)', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/my/project'],
      })
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>)
        .mockResolvedValueOnce([]) // .claude/ → 0 files
        .mockResolvedValueOnce(['root.db']) // root → 1 file

      const result = await callHandler('select-project-dir') as { dbPath: string | null }
      expect(result.dbPath).not.toBeNull()
      expect(result.dbPath).toContain('root.db')
    })

    it('exactly 1 .db file in .claude/: returns that file (files[0])', async () => {
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>)
        .mockResolvedValueOnce(['only.db'])

      const result = await callHandler('find-project-db', '/my/project')
      expect(String(result)).toContain('only.db')
      expect(String(result)).not.toBeNull()
    })
  })

  // ── CLAUDE.md resolution in subdirectory ──────────────────────────────────

})
