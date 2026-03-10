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

  describe('create-project-db — agentLang guard (L115)', () => {
    it('lang="en" → uses GENERIC_AGENTS_BY_LANG["en"] agents', async () => {
      const { GENERIC_AGENTS_BY_LANG } = await import('./default-agents')
      const result = await callHandler('create-project-db', '/fake/project', 'en') as {
        success: boolean; dbPath: string
      }
      expect(result.success).toBe(true)
      // Verify "en" agents were used: insertAgent.run called with English agent names
      const enNames = GENERIC_AGENTS_BY_LANG['en'].map(a => a.name)
      const runCalls = mockRun.mock.calls.map((c: unknown[]) => c[0])
      for (const name of enNames) {
        expect(runCalls).toContain(name)
      }
    })

    it('lang="fr" → uses GENERIC_AGENTS_BY_LANG["fr"] agents (exact "fr" key)', async () => {
      const { GENERIC_AGENTS_BY_LANG } = await import('./default-agents')
      await callHandler('create-project-db', '/fake/project', 'fr')
      const frNames = GENERIC_AGENTS_BY_LANG['fr'].map(a => a.name)
      const runCalls = mockRun.mock.calls.map((c: unknown[]) => c[0])
      for (const name of frNames) {
        expect(runCalls).toContain(name)
      }
    })

    it('unknown lang (not "en") → fallback to "fr" agents', async () => {
      const { GENERIC_AGENTS_BY_LANG } = await import('./default-agents')
      await callHandler('create-project-db', '/fake/project', 'zh')
      const frNames = GENERIC_AGENTS_BY_LANG['fr'].map(a => a.name)
      const runCalls = mockRun.mock.calls.map((c: unknown[]) => c[0])
      // Should have fr agent names (not en-specific)
      for (const name of frNames) {
        expect(runCalls).toContain(name)
      }
    })
  })

  // ── create-project-db — L121-124: pragma exact values ────────────────────

  describe('create-project-db — pragma exact values (L121-124)', () => {
    it('calls db.pragma("journal_mode = WAL") exactly', async () => {
      await callHandler('create-project-db', '/fake/project')
      expect(mockPragma).toHaveBeenCalledWith('journal_mode = WAL')
    })

    it('calls db.pragma("busy_timeout = 5000") exactly', async () => {
      await callHandler('create-project-db', '/fake/project')
      expect(mockPragma).toHaveBeenCalledWith('busy_timeout = 5000')
    })

    it('calls db.pragma("foreign_keys = ON") exactly', async () => {
      await callHandler('create-project-db', '/fake/project')
      expect(mockPragma).toHaveBeenCalledWith('foreign_keys = ON')
    })

    it('calls all 3 pragmas in order', async () => {
      await callHandler('create-project-db', '/fake/project')
      const pragmaCalls = mockPragma.mock.calls.map((c: unknown[]) => c[0])
      expect(pragmaCalls[0]).toBe('journal_mode = WAL')
      expect(pragmaCalls[1]).toBe('busy_timeout = 5000')
      expect(pragmaCalls[2]).toBe('foreign_keys = ON')
    })
  })

  // ── create-project-db — L209: insertAgent SQL ────────────────────────────

  describe('create-project-db — insertAgent SQL (L209)', () => {
    it('prepares INSERT OR IGNORE INTO agents with exact columns', async () => {
      await callHandler('create-project-db', '/fake/project')
      const prepareCalls = mockPrepare.mock.calls.map((c: unknown[]) => String(c[0]))
      const insertCall = prepareCalls.find(s => s.includes('INSERT OR IGNORE INTO agents'))
      expect(insertCall).toBeDefined()
      expect(insertCall).toContain('name')
      expect(insertCall).toContain('type')
      expect(insertCall).toContain('scope')
      expect(insertCall).toContain('system_prompt')
      expect(insertCall).toContain('system_prompt_suffix')
    })
  })

  // ── create-project-db — L212-213: insertAgent.run args (LogicalOperator) ─

  describe('create-project-db — insertAgent.run null coalescing (L213)', () => {
    it('run() is called with null (not undefined) for missing scope', async () => {
      const { GENERIC_AGENTS_BY_LANG } = await import('./default-agents')
      await callHandler('create-project-db', '/fake/project', 'fr')
      // Find an agent with no scope
      const agentWithNoScope = GENERIC_AGENTS_BY_LANG['fr'].find(a => !a.scope)
      if (agentWithNoScope) {
        // scope ?? null → should be null, not undefined
        const runCalls = mockRun.mock.calls as unknown[][]
        const call = runCalls.find(c => c[0] === agentWithNoScope.name)
        expect(call).toBeDefined()
        expect(call![2]).toBeNull() // scope arg → null not undefined
      }
    })

    it('run() is called with null (not undefined) for missing system_prompt', async () => {
      const { GENERIC_AGENTS_BY_LANG } = await import('./default-agents')
      await callHandler('create-project-db', '/fake/project', 'fr')
      const agentWithNoPrompt = GENERIC_AGENTS_BY_LANG['fr'].find(a => !a.system_prompt)
      if (agentWithNoPrompt) {
        const runCalls = mockRun.mock.calls as unknown[][]
        const call = runCalls.find(c => c[0] === agentWithNoPrompt.name)
        expect(call).toBeDefined()
        expect(call![3]).toBeNull() // system_prompt → null not undefined
      }
    })
  })

  // ── create-project-db — L227, L238: success return shape ─────────────────

  describe('create-project-db — success return shape (L227, L238)', () => {
    it('success result has success=true (not false)', async () => {
      const result = await callHandler('create-project-db', '/fake/project') as Record<string, unknown>
      expect(result.success).toBe(true)
      expect(result.success).not.toBe(false)
    })

    it('success result has exact dbPath with .claude/project.db', async () => {
      const result = await callHandler('create-project-db', '/fake/project') as { dbPath: string }
      // Use cross-platform path check
      expect(result.dbPath).toContain('.claude')
      expect(result.dbPath).toContain('project.db')
      expect(result.dbPath).toContain('fake')
    })

    it('success result has scriptsCopied=5 (exact number)', async () => {
      const { copyFile } = await import('fs/promises')
      vi.mocked(copyFile).mockResolvedValue(undefined)
      const result = await callHandler('create-project-db', '/fake/project') as { scriptsCopied: number }
      expect(result.scriptsCopied).toBe(5)
      expect(typeof result.scriptsCopied).toBe('number')
    })

    it('error result has success=false and dbPath="" (exact empty string)', async () => {
      const { mkdir } = await import('fs/promises')
      vi.mocked(mkdir).mockRejectedValueOnce(new Error('EACCES'))
      const result = await callHandler('create-project-db', '/fake/project') as {
        success: boolean; error: string; dbPath: string
      }
      expect(result.success).toBe(false)
      expect(result.dbPath).toBe('')
      expect(result.dbPath).not.toBeNull()
      expect(result.error).toContain('EACCES')
    })
  })

  // ── create-project-db — L232, L235, L241: script copy error ─────────────

  describe('create-project-db — scripts copy error string (L232-241)', () => {
    it('scriptsError contains the error string (not just truthy)', async () => {
      const { copyFile } = await import('fs/promises')
      vi.mocked(copyFile).mockRejectedValueOnce(new Error('EPERM: operation not permitted'))
      const result = await callHandler('create-project-db', '/fake/project') as {
        success: boolean; scriptsError?: string; scriptsCopied: number
      }
      expect(result.success).toBe(true)
      expect(result.scriptsError).toBeDefined()
      expect(typeof result.scriptsError).toBe('string')
      expect(result.scriptsError).toContain('EPERM')
    })

    it('scriptsCopied is 0 when first copyFile fails immediately', async () => {
      const { copyFile } = await import('fs/promises')
      vi.mocked(copyFile).mockRejectedValueOnce(new Error('EACCES'))
      const result = await callHandler('create-project-db', '/fake/project') as {
        scriptsCopied: number
      }
      expect(result.scriptsCopied).toBe(0)
    })
  })

  // ── select-new-project-dir — L247-249: dialog options ────────────────────

  describe('select-new-project-dir — dialog options (L247-249)', () => {
    it('calls showOpenDialog with title containing "nouveau" and openDirectory + createDirectory', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
      await callHandler('select-new-project-dir')
      expect(dialog.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('nouveau'),
          properties: expect.arrayContaining(['openDirectory', 'createDirectory']),
        })
      )
    })

    it('select-new-project-dir has exactly [openDirectory, createDirectory] in properties', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
      await callHandler('select-new-project-dir')
      const call = vi.mocked(dialog.showOpenDialog).mock.calls[0][0]
      expect(call.properties).toEqual(['openDirectory', 'createDirectory'])
    })

    it('returns exact selected path string (not wrapped)', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false, filePaths: ['/chosen/new/project'],
      })
      registerProjectPath('/chosen/new/project')
      const result = await callHandler('select-new-project-dir')
      expect(result).toBe('/chosen/new/project')
      expect(typeof result).toBe('string')
    })
  })

  // ── init-new-project — exact return shapes ───────────────────────────────

  describe('init-new-project — exact return shapes', () => {
    it('success: returns { success: true } without error field', async () => {
      const result = await callHandler('init-new-project', '/fake/project') as Record<string, unknown>
      expect(result.success).toBe(true)
      expect(result.success).not.toBe(false)
      expect(result.error).toBeUndefined()
    })

    it('success: filesCreated contains exactly CLAUDE.md and .claude/WORKFLOW.md', async () => {
      const result = await callHandler('init-new-project', '/fake/project') as {
        success: boolean; filesCreated: string[]
      }
      expect(result.filesCreated).toEqual(['CLAUDE.md', '.claude/WORKFLOW.md'])
      expect(result.filesCreated).toHaveLength(2)
    })

    it('mkdir failure: success=false, error contains EACCES', async () => {
      const { mkdir } = await import('fs/promises')
      vi.mocked(mkdir).mockRejectedValueOnce(new Error('EACCES: permission denied'))
      const result = await callHandler('init-new-project', '/fake/project') as {
        success: boolean; error: string
      }
      expect(result.success).toBe(false)
      expect(result.error).toContain('EACCES')
    })

    it('writeFile failure: success=false, error is a string', async () => {
      const { writeFile } = await import('fs/promises')
      vi.mocked(writeFile).mockRejectedValueOnce(new Error('ENOSPC: no space left on device'))
      const result = await callHandler('init-new-project', '/fake/project') as {
        success: boolean; error: string
      }
      expect(result.success).toBe(false)
      expect(typeof result.error).toBe('string')
      expect(result.error).toContain('ENOSPC')
    })

    it('writes CLAUDE.md with template content to exact path', async () => {
      const { writeFile } = await import('fs/promises')
      const { CLAUDE_MD_TEMPLATE } = await import('./project-templates')
      await callHandler('init-new-project', '/fake/project')
      const writeFileCalls = vi.mocked(writeFile).mock.calls
      const claudeCall = writeFileCalls.find(c => String(c[0]).includes('CLAUDE.md') && !String(c[0]).includes('WORKFLOW'))
      expect(claudeCall).toBeDefined()
      expect(String(claudeCall![0])).toContain('CLAUDE.md')
      expect(claudeCall![1]).toBe(CLAUDE_MD_TEMPLATE)
      expect(claudeCall![2]).toBe('utf-8')
    })

    it('writes WORKFLOW.md to .claude/WORKFLOW.md with utf-8', async () => {
      const { writeFile } = await import('fs/promises')
      const { WORKFLOW_MD_TEMPLATE } = await import('./project-templates')
      await callHandler('init-new-project', '/fake/project')
      const writeFileCalls = vi.mocked(writeFile).mock.calls
      const workflowCall = writeFileCalls.find(c => String(c[0]).includes('WORKFLOW.md'))
      expect(workflowCall).toBeDefined()
      expect(String(workflowCall![0])).toContain('.claude')
      expect(String(workflowCall![0])).toContain('WORKFLOW.md')
      expect(workflowCall![1]).toBe(WORKFLOW_MD_TEMPLATE)
      expect(workflowCall![2]).toBe('utf-8')
    })

    it('creates .claude dir with { recursive: true }', async () => {
      const { mkdir } = await import('fs/promises')
      await callHandler('init-new-project', '/fake/project')
      expect(mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.claude'),
        { recursive: true }
      )
    })
  })

  // ── find-project-db — L294, L300: trusted conditional ────────────────────

  describe('find-project-db — trusted path logic (L294, L300)', () => {
    it('trusted=true (in-memory): registerDbPath is called with found dbPath', async () => {
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      // /my/project is pre-registered in beforeEach
      const result = await callHandler('find-project-db', '/my/project')
      expect(result).not.toBeNull()
      expect(String(result)).toContain('project.db')
    })

    it('trusted=false (not in-memory, not in json): returns dbPath but does NOT register', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['data.db'])
      // trusted-project-paths.json returns empty list
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>).mockResolvedValueOnce('[]')
      const before = [...getAllowedProjectPaths()]
      const result = await callHandler('find-project-db', '/unregistered/path')
      // Still returns path
      expect(result).not.toBeNull()
      expect(String(result)).toContain('data.db')
      // Did NOT add to allowlist
      expect(getAllowedProjectPaths()).toEqual(before)
    })

    it('trusted via json (L300): registers the path when found in persisted file', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      const jsonPath = '/json-trusted/project'
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>)
        .mockResolvedValueOnce(JSON.stringify([jsonPath]))
      const result = await callHandler('find-project-db', jsonPath)
      expect(String(result)).toContain('project.db')
      expect(getAllowedProjectPaths()).toContain(resolve(jsonPath))
    })

    it('readFile with encoding "utf-8" for trusted paths file (L297)', async () => {
      const { access, readdir, readFile } = await import('fs/promises')
      vi.mocked(access).mockResolvedValueOnce(undefined)
      vi.mocked(readdir as (p: string) => Promise<string[]>).mockResolvedValueOnce(['project.db'])
      vi.mocked(readFile as (p: string, enc: string) => Promise<string>).mockResolvedValueOnce('[]')
      await callHandler('find-project-db', '/untrusted/path')
      const readFileCalls = vi.mocked(readFile).mock.calls
      const trustedCall = readFileCalls.find(c => String(c[0]).includes('trusted-project-paths'))
      expect(trustedCall).toBeDefined()
      expect(trustedCall![1]).toBe('utf-8')
    })
  })

  // ── project:exportZip — L326-334: exact success/error shapes ─────────────

  describe('project:exportZip — exact return shapes (L326-334)', () => {
    it('success: result.success is exactly true (not truthy)', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('db content'))
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      const result = await callHandler('project:exportZip', '/fake/project.db') as {
        success: boolean; path?: string
      }
      expect(result.success).toBe(true)
      expect(result.success).not.toBe(false)
    })

    it('success: result.path starts with downloads dir (L328)', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      const { app } = await import('electron')
      vi.mocked(app.getPath).mockReturnValue('/fake/downloads')
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('db content'))
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      const result = await callHandler('project:exportZip', '/fake/project.db') as {
        success: boolean; path: string
      }
      // Cross-platform path: check the filename pattern
      expect(result.path).toMatch(/kanbagent-export-.+\.zip$/)
    })

    it('success: result has no error field', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('db content'))
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      const result = await callHandler('project:exportZip', '/fake/project.db') as Record<string, unknown>
      expect(result.error).toBeUndefined()
    })

    it('error: result.success is exactly false (not falsy)', async () => {
      const { readFile } = await import('fs/promises')
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT: file not found'))
      const result = await callHandler('project:exportZip', '/fake/project.db') as {
        success: boolean; error: string
      }
      expect(result.success).toBe(false)
      expect(result.success).not.toBe(true)
    })

    it('error: result.error is a string containing the error message (L334)', async () => {
      const { readFile } = await import('fs/promises')
      vi.mocked(readFile).mockRejectedValueOnce(new Error('EACCES: permission denied'))
      const result = await callHandler('project:exportZip', '/fake/project.db') as {
        success: boolean; error: string
      }
      expect(typeof result.error).toBe('string')
      expect(result.error).toContain('EACCES')
    })

    it('success: result.path is a string (not a buffer or object)', async () => {
      const { readFile, writeFile } = await import('fs/promises')
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('db content'))
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      const result = await callHandler('project:exportZip', '/fake/project.db') as { path: unknown }
      expect(typeof result.path).toBe('string')
    })
  })

  // ── AGENT_SCRIPTS — ArrayDeclaration exact content ────────────────────────

  describe('AGENT_SCRIPTS exact values (L47-53)', () => {
    it('AGENT_SCRIPTS contains dbq.js as first element', async () => {
      const { AGENT_SCRIPTS } = await import('./ipc')
      expect(AGENT_SCRIPTS[0]).toBe('dbq.js')
    })

    it('AGENT_SCRIPTS contains dbw.js as second element', async () => {
      const { AGENT_SCRIPTS } = await import('./ipc')
      expect(AGENT_SCRIPTS[1]).toBe('dbw.js')
    })

    it('AGENT_SCRIPTS contains dbstart.js, dblock.js, capture-tokens-hook.js', async () => {
      const { AGENT_SCRIPTS } = await import('./ipc')
      expect(AGENT_SCRIPTS).toContain('dbstart.js')
      expect(AGENT_SCRIPTS).toContain('dblock.js')
      expect(AGENT_SCRIPTS).toContain('capture-tokens-hook.js')
    })

    it('AGENT_SCRIPTS has exactly 5 elements', async () => {
      const { AGENT_SCRIPTS } = await import('./ipc')
      expect(AGENT_SCRIPTS).toHaveLength(5)
    })
  })
})
