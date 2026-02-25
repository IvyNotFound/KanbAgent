/**
 * Tests for IPC handlers — src/main/ipc.ts
 *
 * Strategy: mock electron (ipcMain), sql.js, and fs to capture and invoke
 * handlers directly without spawning an Electron process.
 *
 * Security focus:
 * - query-db: FORBIDDEN_WRITE_KEYWORDS enforcement
 * - fs:writeFile / fs:readFile: path traversal and allowedDir checks
 * - isPathAllowed: boundary conditions
 * - migrate-db: success/error paths
 * - findProjectDb: directory traversal logic
 *
 * Framework: Vitest (node environment — configured via environmentMatchGlobs in vitest.config.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Electron mock ──────────────────────────────────────────────────────────────
// Capture handlers registered via ipcMain.handle()
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
  },
}))

// ── sql.js mock ────────────────────────────────────────────────────────────────
const mockStmt = {
  bind: vi.fn(),
  step: vi.fn().mockReturnValue(false),
  getAsObject: vi.fn().mockReturnValue({}),
  free: vi.fn(),
}

const mockSqlDb = {
  prepare: vi.fn(() => mockStmt),
  exec: vi.fn(() => []),
  run: vi.fn(),
  export: vi.fn(() => new Uint8Array([1, 2, 3])),
  close: vi.fn(),
  getRowsModified: vi.fn(() => 0),
}

const mockSqlJs = {
  Database: vi.fn(() => mockSqlDb),
}

vi.mock('sql.js', () => ({
  default: vi.fn().mockResolvedValue(mockSqlJs),
}))

// ── fs mock ────────────────────────────────────────────────────────────────────
// Note: importOriginal cannot be used here because Node.js built-in 'fs' has no
// ESM default export in Vitest's environment, which causes a "No default export"
// error. We provide an explicit mock with a default export for CJS/ESM interop.
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
  return {
    default: { readFile, writeFile, mkdir, rename, stat },
    readFile,
    writeFile,
    mkdir,
    rename,
    stat,
  }
})

// ── Import ipc.ts AFTER mocks are set up ───────────────────────────────────────
// This triggers registerIpcHandlers() side effects via the mock above
import { registerIpcHandlers } from './ipc'

// Helper to call a captured handler
async function callHandler(channel: string, ...args: unknown[]) {
  const handler = handlers[channel]
  if (!handler) throw new Error(`Handler not found: ${channel}. Available: ${Object.keys(handlers).join(', ')}`)
  return handler(null, ...args)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IPC handlers — src/main/ipc.ts', () => {
  beforeEach(() => {
    // Register all handlers before each test
    vi.clearAllMocks()
    // Re-register handlers (they are cleared by clearAllMocks on ipcMain.handle)
    registerIpcHandlers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── query-db : FORBIDDEN_WRITE_KEYWORDS ────────────────────────────────────

  describe('query-db — write keyword enforcement', () => {
    const dbPath = '/fake/project.db'

    it('should block INSERT queries', async () => {
      const result = await callHandler('query-db', dbPath, "INSERT INTO tasks (titre) VALUES ('hack')")
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Write operations'),
      })
    })

    it('should block UPDATE queries', async () => {
      const result = await callHandler('query-db', dbPath, "UPDATE tasks SET statut='terminé' WHERE id=1")
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Write operations') })
    })

    it('should block DELETE queries', async () => {
      const result = await callHandler('query-db', dbPath, 'DELETE FROM tasks WHERE id=1')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Write operations') })
    })

    it('should block DROP queries', async () => {
      const result = await callHandler('query-db', dbPath, 'DROP TABLE tasks')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Write operations') })
    })

    it('should block ALTER queries', async () => {
      const result = await callHandler('query-db', dbPath, 'ALTER TABLE agents ADD COLUMN foo TEXT')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Write operations') })
    })

    it('should block CREATE queries', async () => {
      const result = await callHandler('query-db', dbPath, 'CREATE TABLE foo (id INTEGER)')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Write operations') })
    })

    it('should block TRUNCATE queries', async () => {
      const result = await callHandler('query-db', dbPath, 'TRUNCATE TABLE tasks')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Write operations') })
    })

    it('should block case-insensitive write attempts', async () => {
      const result = await callHandler('query-db', dbPath, 'insert into tasks (titre) values (1)')
      expect(result).toMatchObject({ success: false })
    })

    it('should allow SELECT queries past keyword check (throws on invalid db — not a keyword error)', async () => {
      // SELECT passes the FORBIDDEN_WRITE_KEYWORDS filter.
      // query-db re-throws DB errors (unlike other handlers that catch them).
      // Test verifies that the error is a DB error, not a "Write operations" rejection.
      await expect(callHandler('query-db', dbPath, 'SELECT * FROM tasks')).rejects.toThrow()
    })

    it('should document known limitation: INSERT in WHERE value is incorrectly blocked', async () => {
      // KNOWN LIMITATION: current implementation uses .includes() on full query string
      // "SELECT * FROM tasks WHERE titre = 'INSERT something'" → blocked because "INSERT" is found
      // This is a false positive — values should not be scanned, only SQL keywords
      // This test documents the current behavior (not ideal but known)
      const result = await callHandler('query-db', dbPath, "SELECT * FROM tasks WHERE titre = 'INSERT something'", [])
      // Current behavior: blocked (false positive)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Write operations') })
    })
  })

  // ── isPathAllowed (via fs:writeFile handler) ───────────────────────────────

  describe('fs:writeFile — path security (isPathAllowed)', () => {
    const allowedDir = '/home/user/project'
    const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn().mockResolvedValue(undefined) }))

    it('should allow writing a file within allowedDir', async () => {
      const filePath = '/home/user/project/src/file.ts'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      expect(result).toMatchObject({ success: true })
    })

    it('should block path traversal via ..', async () => {
      const filePath = '/home/user/project/../../../etc/passwd'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Path traversal') })
    })

    it('should block path outside allowedDir', async () => {
      const filePath = '/home/other-user/secret.txt'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('not in allowed directory') })
    })

    it('should block writing to .ssh directory', async () => {
      const filePath = '/home/user/project/.ssh/authorized_keys'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('sensitive') })
    })

    it('should block writing to .bashrc', async () => {
      const filePath = '/home/user/project/.bashrc'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('sensitive') })
    })

    it('should block writing to /etc/ paths', async () => {
      const filePath = '/etc/hosts'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      // Should be blocked by either path traversal, allowedDir, or sensitive check
      expect(result).toMatchObject({ success: false })
    })

    it('should allow writing without allowedDir constraint (relative path)', async () => {
      const filePath = 'relative/path/file.txt'
      const result = await callHandler('fs:writeFile', filePath, 'content')
      // No allowedDir = relative paths OK (no absolute path rejection for write)
      expect(result).toMatchObject({ success: true })
    })
  })

  // ── fs:readFile ─────────────────────────────────────────────────────────────

  describe('fs:readFile — path security', () => {
    it('should block path traversal via ..', async () => {
      const result = await callHandler('fs:readFile', '../../../etc/passwd', '/allowed')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Path traversal') })
    })

    it('should block file outside allowedDir', async () => {
      const result = await callHandler('fs:readFile', '/etc/passwd', '/home/user/project')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('not in allowed directory') })
    })

    it('should return file content on success', async () => {
      const { readFile } = await import('fs/promises')
      vi.mocked(readFile).mockResolvedValueOnce('file content' as unknown as Buffer)
      const result = await callHandler('fs:readFile', '/allowed/file.txt', '/allowed') as { success: boolean; content: string }
      expect(result.success).toBe(true)
      expect(result.content).toBe('file content')
    })

    it('should return error object when file does not exist', async () => {
      const { readFile } = await import('fs/promises')
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT: no such file'))
      const result = await callHandler('fs:readFile', '/allowed/missing.txt', '/allowed')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('ENOENT') })
    })
  })

  // ── fs:listDir ───────────────────────────────────────────────────────────────

  describe('fs:listDir — path security', () => {
    it('should block path traversal via ..', async () => {
      const result = await callHandler('fs:listDir', '../../../etc', '/allowed')
      expect(result).toEqual([])
    })

    it('should block directory outside allowedDir', async () => {
      const result = await callHandler('fs:listDir', '/other/path', '/allowed/project')
      expect(result).toEqual([])
    })
  })

  // ── migrate-db ───────────────────────────────────────────────────────────────

  describe('migrate-db handler', () => {
    it('should return { success: false, error } on migration error', async () => {
      // readFile is mocked to return a bidon buffer (via vi.mock fs/promises).
      // sql.js loads the buffer as an empty DB → migrateDb fails on missing schema.
      // The handler catches the error and returns { success: false, error }.
      const result = await callHandler('migrate-db', '/fake/project.db') as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false })
      expect(typeof result.error).toBe('string')
    })

    it('should return object with success property', async () => {
      // Verify the handler always returns a structured response
      const result = await callHandler('migrate-db', '/nonexistent/path/project.db') as { success: boolean }
      expect(result).toHaveProperty('success')
      expect(typeof result.success).toBe('boolean')
    })
  })

  // ── find-project-db ──────────────────────────────────────────────────────────

  describe('find-project-db handler', () => {
    it('should return null when no db found', async () => {
      const { existsSync, readdirSync } = await import('fs')
      vi.mocked(existsSync).mockReturnValue(false)
      vi.mocked(readdirSync as (path: string) => string[]).mockReturnValue([])
      const result = await callHandler('find-project-db', '/empty/project')
      expect(result).toBeNull()
    })

    it('should find db in .claude/ subdirectory', async () => {
      const { existsSync, readdirSync } = await import('fs')
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync as (path: string) => string[]).mockReturnValue(['project.db'])
      const result = await callHandler('find-project-db', '/my/project')
      expect(result).toContain('project.db')
      expect(result).toContain('.claude')
    })

    it('should fall back to root directory if .claude/ has no db', async () => {
      const { existsSync, readdirSync } = await import('fs')
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync as (path: string) => string[])
        .mockReturnValueOnce([]) // .claude/ dir: no .db files
        .mockReturnValueOnce(['project.db']) // root: has .db file
      const result = await callHandler('find-project-db', '/my/project')
      expect(result).toContain('project.db')
    })
  })

  // ── window controls ──────────────────────────────────────────────────────────

  describe('window controls', () => {
    it('should handle window-minimize gracefully when no focused window', async () => {
      const { BrowserWindow } = await import('electron')
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)
      await expect(callHandler('window-minimize')).resolves.not.toThrow()
    })

    it('should handle window-close gracefully when no focused window', async () => {
      const { BrowserWindow } = await import('electron')
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)
      await expect(callHandler('window-close')).resolves.not.toThrow()
    })

    it('should return false for window-is-maximized when no focused window', async () => {
      const { BrowserWindow } = await import('electron')
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)
      const result = await callHandler('window-is-maximized')
      expect(result).toBe(false)
    })
  })

  // ── search-tasks ─────────────────────────────────────────────────────────────
  // Note: search-tasks uses queryLive → real sql.js (require() bypass vi.mock).
  // Tests validate handler contract: returns { success, results } shape on error paths.

  describe('search-tasks handler', () => {
    it('should return { success: false } when dbPath is invalid (no such file)', async () => {
      const result = await callHandler('search-tasks', '/nonexistent/db.sqlite', '') as { success: boolean; results: unknown[] }
      // queryLive will throw (file not found) → handler catches and returns error shape
      expect(result).toMatchObject({ success: false, results: [] })
    })

    it('should return { success: false } with results array on DB error', async () => {
      const result = await callHandler('search-tasks', '/nonexistent/db.sqlite', 'my task') as { success: boolean; results: unknown[] }
      expect(result.success).toBe(false)
      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  // ── get-config-value ─────────────────────────────────────────────────────────
  // Note: get-config-value uses queryLive → real sql.js. Tests validate error contract.

  describe('get-config-value handler', () => {
    it('should return { success: false } when dbPath does not exist', async () => {
      const result = await callHandler('get-config-value', '/nonexistent/db.sqlite', 'some_key') as { success: boolean; value: unknown }
      expect(result.success).toBe(false)
    })

    it('should return { success, value } shape', async () => {
      const result = await callHandler('get-config-value', '/nonexistent/db.sqlite', 'github_token') as { success: boolean; value: unknown; error?: string }
      // Shape validation — value is null on error
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('value')
    })
  })

  // ── build-agent-prompt ───────────────────────────────────────────────────────

  describe('build-agent-prompt handler', () => {
    it('should concatenate agentName and userPrompt', async () => {
      const result = await callHandler('build-agent-prompt', 'dev-front', 'Tu es dev') as string
      expect(typeof result).toBe('string')
      expect(result).toContain('dev-front')
    })
  })
})

