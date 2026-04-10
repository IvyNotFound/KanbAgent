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

    it('unknown lang → fallback to "en" agents', async () => {
      const { GENERIC_AGENTS_BY_LANG } = await import('./default-agents')
      await callHandler('create-project-db', '/fake/project', 'xx')
      const enNames = GENERIC_AGENTS_BY_LANG['en'].map(a => a.name)
      const runCalls = mockRun.mock.calls.map((c: unknown[]) => c[0])
      for (const name of enNames) {
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

})
