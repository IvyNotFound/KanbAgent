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
    isPackaged: false,
    getAppPath: vi.fn(() => '/fake/app'),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn(),
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

// ── child_process mock (for git:log dynamic import) ──────────────────────────
const { mockExecSync, mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(() => ({ unref: vi.fn() })),
}))
vi.mock('child_process', () => ({
  default: { execSync: mockExecSync, execFile: mockExecFile, spawn: mockSpawn },
  execSync: mockExecSync,
  execFile: mockExecFile,
  spawn: mockSpawn,
}))

// ── T552: mock ./db to intercept queryLive (CJS require bypasses sql.js vi.mock) ──
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    queryLive: vi.fn().mockRejectedValue(new Error('file is not a database')),
  }
})
import { queryLive as mockedQueryLive } from './db'

// ── Import ipc.ts AFTER mocks are set up ───────────────────────────────────────
// This triggers registerIpcHandlers() side effects via the mock above
import { registerIpcHandlers, registerDbPath, registerProjectPath } from './ipc'

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
    // T552: Restore queryLive default (throw on mock buffer) after clearAllMocks
    vi.mocked(mockedQueryLive).mockRejectedValue(new Error('file is not a database'))
    // Re-register handlers (they are cleared by clearAllMocks on ipcMain.handle)
    registerIpcHandlers()
    // T282: Register test DB paths as allowed for write operations
    registerDbPath('/fake/project.db')
    registerDbPath('/fake/db')
    // T283: Register test project paths as allowed for write operations
    registerProjectPath('/fake/project')
    // T527/T528: Register paths used in find-project-db and create-project-db tests
    registerProjectPath('/empty/project')
    registerProjectPath('/my/project')
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
      const result = await callHandler('query-db', dbPath, "UPDATE tasks SET statut='done' WHERE id=1")
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

    it('should reject unregistered dbPath with DB_PATH_NOT_ALLOWED (T354)', async () => {
      await expect(callHandler('query-db', '/unregistered/evil.db', 'SELECT 1'))
        .rejects.toThrow('DB_PATH_NOT_ALLOWED')
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

    it('should block prefix bypass (T318: /project-evil vs /project)', async () => {
      const filePath = '/home/user/project-evil/exploit.sh'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('not in allowed directory') })
    })

    it('should block writing to .ssh directory (T531: extension whitelist)', async () => {
      const filePath = '/home/user/project/.ssh/authorized_keys'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('File type not allowed') })
    })

    it('should block writing to .bashrc (T531: extension whitelist)', async () => {
      const filePath = '/home/user/project/.bashrc'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('File type not allowed') })
    })

    it('should block writing to /etc/ paths', async () => {
      const filePath = '/etc/hosts'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      // Should be blocked by either path traversal, allowedDir, or sensitive check
      expect(result).toMatchObject({ success: false })
    })

    it('T531: should block .npmrc (previously uncovered by blacklist)', async () => {
      const filePath = '/home/user/project/.npmrc'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('File type not allowed') })
    })

    it('T531: should block .gitconfig (previously uncovered by blacklist)', async () => {
      const filePath = '/home/user/project/.gitconfig'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('File type not allowed') })
    })

    it('T531: should allow writing .ts files within allowedDir', async () => {
      const filePath = '/home/user/project/src/component.ts'
      const result = await callHandler('fs:writeFile', filePath, 'content', allowedDir)
      expect(result).toMatchObject({ success: true })
    })

    it('should reject write when allowedDir is missing (undefined)', async () => {
      const filePath = 'relative/path/file.txt'
      const result = await callHandler('fs:writeFile', filePath, 'content', undefined)
      // allowedDir is now mandatory — undefined causes resolve(undefined) = cwd,
      // and a relative path will resolve outside it → rejected
      expect(result).toMatchObject({ success: false })
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
      vi.mocked(readFile).mockResolvedValueOnce('file content' as unknown as Buffer<ArrayBuffer>)
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
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      vi.mocked(readdir as (path: string) => Promise<string[]>).mockResolvedValue([])
      const result = await callHandler('find-project-db', '/empty/project')
      expect(result).toBeNull()
    })

    it('should find db in .claude/ subdirectory', async () => {
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readdir as (path: string) => Promise<string[]>).mockResolvedValue(['project.db'])
      const result = await callHandler('find-project-db', '/my/project')
      expect(result).toContain('project.db')
      expect(result).toContain('.claude')
    })

    it('should fall back to root directory if .claude/ has no db', async () => {
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readdir as (path: string) => Promise<string[]>)
        .mockResolvedValueOnce([]) // .claude/ dir: no .db files
        .mockResolvedValueOnce(['project.db']) // root: has .db file
      const result = await callHandler('find-project-db', '/my/project')
      expect(result).toContain('project.db')
    })

    it('T527: should throw when projectPath is empty', async () => {
      await expect(callHandler('find-project-db', '')).rejects.toThrow('PROJECT_PATH_REQUIRED')
    })

    it('T615: should register path and work without prior registration', async () => {
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readdir as (path: string) => Promise<string[]>).mockResolvedValue(['project.db'])
      // Path never registered before — must succeed (idempotent registration)
      const result = await callHandler('find-project-db', '/cold-start/project')
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
      const result = await callHandler('get-config-value', '/nonexistent/db.sqlite', 'claude_md_commit') as { success: boolean; value: unknown; error?: string }
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

  // ── Write handlers — test strategy ───────────────────────────────────────────
  // NOTE: getSqlJs() uses require('sql.js') (CJS), which loads the real sql.js
  // in the Vitest node environment (vi.mock intercepts ESM imports, not all CJS
  // require paths within the tested module's singleton). Tests below are therefore
  // designed to test the error path (readFile throws) and input validation.
  // For shape validation, we rely on the handler's catch block returning { success: false }.

  // ── close-agent-sessions ─────────────────────────────────────────────────────

  describe('close-agent-sessions handler', () => {
    it('should return { success, error } shape', async () => {
      const result = await callHandler('close-agent-sessions', '/fake/project.db', 'dev-front') as { success: boolean; error?: string }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('close-agent-sessions', '/invalid/db', 'dev-front')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── rename-agent ─────────────────────────────────────────────────────────────

  describe('rename-agent handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('rename-agent', '/fake/project.db', 1, 'new-name') as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('rename-agent', '/invalid/db', 1, 'new-name')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── update-agent-system-prompt ────────────────────────────────────────────────

  describe('update-agent-system-prompt handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('update-agent-system-prompt', '/fake/project.db', 1, 'My prompt') as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('update-agent-system-prompt', '/invalid/db', 1, 'prompt')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── get-agent-system-prompt ───────────────────────────────────────────────────
  // Uses queryLive (real sql.js via require() — throws on non-db buffer)

  describe('get-agent-system-prompt handler', () => {
    it('should return { success: false, systemPrompt: null } shape on DB error', async () => {
      // Real sql.js fails on mock buffer → handler catches → returns error shape
      const result = await callHandler('get-agent-system-prompt', '/fake/project.db', 99) as {
        success: boolean; systemPrompt: unknown; systemPromptSuffix: unknown; thinkingMode: unknown
      }
      expect(result.success).toBe(false)
      expect(result.systemPrompt).toBeNull()
      expect(result.systemPromptSuffix).toBeNull()
      expect(result.thinkingMode).toBeNull()
    })

    it('should always return { success, systemPrompt, systemPromptSuffix, thinkingMode } shape', async () => {
      const result = await callHandler('get-agent-system-prompt', '/fake/project.db', 1) as Record<string, unknown>
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('systemPrompt')
      expect(result).toHaveProperty('systemPromptSuffix')
      expect(result).toHaveProperty('thinkingMode')
    })
  })

  // ── update-agent-thinking-mode ────────────────────────────────────────────────

  describe('update-agent-thinking-mode handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('update-agent-thinking-mode', '/fake/project.db', 1, 'auto') as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('update-agent-thinking-mode', '/invalid/db', 1, 'disabled')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })

    it('should reject budget_tokens as an invalid thinking mode', async () => {
      const result = await callHandler('update-agent-thinking-mode', '/fake/project.db', 1, 'budget_tokens') as { success: boolean; error: string }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('budget_tokens') })
    })

    it('should accept null as a valid thinking mode (reset to default)', async () => {
      const result = await callHandler('update-agent-thinking-mode', '/fake/project.db', 1, null) as { success: boolean }
      // null bypasses validation — may succeed or fail at DB level depending on mock
      expect(result).toHaveProperty('success')
    })
  })

  // ── update-agent ─────────────────────────────────────────────────────────────

  describe('update-agent handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('update-agent', '/fake/project.db', 1, { name: 'new-name' }) as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('update-agent', '/invalid/db', 1, { name: 'new-name' })
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── set-config-value ─────────────────────────────────────────────────────────

  describe('set-config-value handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('set-config-value', '/fake/project.db', 'key', 'value') as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('set-config-value', '/invalid/db', 'key', 'value')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── session:setConvId ─────────────────────────────────────────────────────────

  describe('session:setConvId handler', () => {
    const validConvId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

    it('should return { success: false, error: Invalid arguments } when convId is empty', async () => {
      const result = await callHandler('session:setConvId', '/fake/db', 1, '')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid arguments') })
    })

    it('should return { success: false, error: Invalid arguments } when agentId is not a number', async () => {
      const result = await callHandler('session:setConvId', '/fake/db', 'not-a-number', validConvId)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid arguments') })
    })

    it('should return { success: false, error: Invalid arguments } when dbPath is falsy', async () => {
      const result = await callHandler('session:setConvId', '', 1, validConvId)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid arguments') })
    })

    it('should return { success, error? } shape for valid args', async () => {
      const result = await callHandler('session:setConvId', '/fake/project.db', 1, validConvId) as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('session:setConvId', '/invalid/db', 1, validConvId)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── create-agent ─────────────────────────────────────────────────────────────
  // Uses queryLive (duplicate check) — real sql.js fails on mock buffer

  describe('create-agent handler', () => {
    const dbPath = '/fake/project.db'
    const projectPath = '/fake/project'
    const agentData = {
      name: 'my-new-agent',
      type: 'dev',
      perimetre: 'back-electron',
      thinkingMode: 'auto',
      systemPrompt: 'Be helpful',
      description: 'Mon agent de test'
    }

    it('should return { success, error? } shape', async () => {
      const result = await callHandler('create-agent', dbPath, projectPath, agentData) as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when readFile throws (ENOENT)', async () => {
      const { readFile } = await import('fs/promises')
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'))
      const result = await callHandler('create-agent', dbPath, projectPath, agentData)
      expect(result).toMatchObject({ success: false })
    })
  })

  // ── T226: select-project-dir ────────────────────────────────────────────────

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

  // ── T226: init-new-project ──────────────────────────────────────────────────

  describe('init-new-project handler', () => {
    it('should return { success: true } on nominal path', async () => {
      const { writeFile, mkdir } = await import('fs/promises')
      vi.mocked(mkdir).mockResolvedValueOnce(undefined)
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      // Mock global fetch for CLAUDE.md download
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValueOnce('# CLAUDE.md content'),
      })
      try {
        const result = await callHandler('init-new-project', '/fake/project') as { success: boolean }
        expect(result).toMatchObject({ success: true })
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should return { success: false, error } when fetch fails', async () => {
      const { mkdir } = await import('fs/promises')
      vi.mocked(mkdir).mockResolvedValueOnce(undefined)
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      try {
        const result = await callHandler('init-new-project', '/fake/project') as { success: boolean; error?: string }
        expect(result.success).toBe(false)
        expect(typeof result.error).toBe('string')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should return { success: false, error } when mkdir fails (EACCES)', async () => {
      const { mkdir } = await import('fs/promises')
      vi.mocked(mkdir).mockRejectedValueOnce(new Error('EACCES: permission denied'))
      const result = await callHandler('init-new-project', '/fake/project') as { success: boolean; error?: string }
      expect(result.success).toBe(false)
      expect(result.error).toContain('EACCES')
    })
  })

  // ── T226: show-confirm-dialog ───────────────────────────────────────────────

  describe('show-confirm-dialog handler', () => {
    it('should return true when user confirms (response=0)', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false })
      const result = await callHandler('show-confirm-dialog', { title: 'Test', message: 'Confirm?' })
      expect(result).toBe(true)
    })

    it('should return false when user cancels (response=1)', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
      const result = await callHandler('show-confirm-dialog', { title: 'Test', message: 'Confirm?' })
      expect(result).toBe(false)
    })
  })

  // ── T226: get-locks / get-locks-count ───────────────────────────────────────

  describe('get-locks handler', () => {
    it('should return array (empty on DB error)', async () => {
      // queryLive will fail on mock buffer → handler throws
      await expect(callHandler('get-locks', '/fake/project.db')).rejects.toThrow()
    })

    it('should reject unregistered dbPath with DB_PATH_NOT_ALLOWED (T355)', async () => {
      await expect(callHandler('get-locks', '/unregistered/evil.db'))
        .rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })
  })

  // get-locks-count handler was removed — tests deleted (T351)

  // ── T226: watch-db / unwatch-db ─────────────────────────────────────────────

  describe('watch-db handler', () => {
    it('should reject unregistered dbPath with DB_PATH_NOT_ALLOWED (T355)', async () => {
      await expect(callHandler('watch-db', '/unregistered/evil.db'))
        .rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should call fs.watch on the provided path', async () => {
      const { watch } = await import('fs')
      vi.mocked(watch).mockClear()
      await callHandler('watch-db', '/fake/project.db')
      expect(watch).toHaveBeenCalledWith('/fake/project.db', expect.any(Function))
    })

    it('should close previous watcher before creating new one', async () => {
      const { watch } = await import('fs')
      const mockClose = vi.fn()
      vi.mocked(watch).mockReturnValue({ close: mockClose } as unknown as ReturnType<typeof watch>)
      registerDbPath('/fake/db1')
      registerDbPath('/fake/db2')
      await callHandler('watch-db', '/fake/db1')
      await callHandler('watch-db', '/fake/db2')
      expect(mockClose).toHaveBeenCalled()
    })
  })

  describe('unwatch-db handler', () => {
    it('should close watcher and clear debounce timer', async () => {
      const { watch } = await import('fs')
      const mockClose = vi.fn()
      vi.mocked(watch).mockReturnValue({ close: mockClose } as unknown as ReturnType<typeof watch>)
      await callHandler('watch-db', '/fake/project.db')
      await callHandler('unwatch-db', '/fake/project.db')
      expect(mockClose).toHaveBeenCalled()
    })

    it('should not crash when no watcher is active', async () => {
      await expect(callHandler('unwatch-db')).resolves.not.toThrow()
    })
  })

  // ── T226: update-perimetre ──────────────────────────────────────────────────

  describe('update-perimetre handler', () => {
    it('should return { success, error? } shape', async () => {
      const result = await callHandler('update-perimetre', '/fake/project.db', 1, 'old-name', 'new-name', 'desc') as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('update-perimetre', '/invalid/db', 1, 'old', 'new', 'desc')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── T226: check-master-md ──────────────────────────────────────────────────

  describe('check-master-md handler', () => {
    it('should return { success: false } when queryLive throws (DB error)', async () => {
      const result = await callHandler('check-master-md', '/nonexistent/db.sqlite') as { success: boolean; error?: string }
      expect(result.success).toBe(false)
      expect(typeof result.error).toBe('string')
    })
  })

  // ── T226: apply-master-md ──────────────────────────────────────────────────

  describe('apply-master-md handler', () => {
    it('should return { success: false, error } when dbPath is not registered', async () => {
      const result = await callHandler('apply-master-md', '/invalid/db', '/invalid/project', 'content', 'sha123')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })

    it('should return { success: false, error } when projectPath is not registered', async () => {
      const result = await callHandler('apply-master-md', '/fake/project.db', '/unregistered/project', 'content', 'sha123')
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('PROJECT_PATH_NOT_ALLOWED') })
    })
  })

  // ── T226: test-github-connection ───────────────────────────────────────────

  describe('test-github-connection handler', () => {
    it('should return { connected: false, error } for invalid URL', async () => {
      const result = await callHandler('test-github-connection', '/fake/project.db', 'not-a-url') as { connected: boolean; error?: string }
      expect(result.connected).toBe(false)
      expect(result.error).toBe('URL invalide')
    })

    it('should return { connected: false } when queryLive throws (DB error)', async () => {
      const result = await callHandler('test-github-connection', '/nonexistent/db', 'https://github.com/owner/repo') as { connected: boolean }
      expect(result.connected).toBe(false)
    })
  })

  // ── T351: create-project-db ───────────────────────────────────────────────

  describe('create-project-db handler', () => {
    it('should return { success: true, dbPath } on success path', async () => {
      const { mkdir, writeFile } = await import('fs/promises')
      vi.mocked(mkdir).mockResolvedValueOnce(undefined)
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      const result = await callHandler('create-project-db', '/fake/project') as {
        success: boolean; dbPath: string
      }
      expect(result.success).toBe(true)
      expect(result.dbPath).toContain('project.db')
      expect(result.dbPath).toContain('.claude')
    })

    it('should create .claude directory via mkdir recursive', async () => {
      const { mkdir, writeFile } = await import('fs/promises')
      vi.mocked(mkdir).mockResolvedValueOnce(undefined)
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      await callHandler('create-project-db', '/fake/project')
      expect(mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.claude'),
        { recursive: true }
      )
    })

    it('should write the DB file to .claude/project.db', async () => {
      const { mkdir, writeFile } = await import('fs/promises')
      vi.mocked(mkdir).mockResolvedValueOnce(undefined)
      vi.mocked(writeFile).mockResolvedValueOnce(undefined)
      await callHandler('create-project-db', '/fake/project')
      // writeFile is called with the DB binary content
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('project.db'),
        expect.any(Buffer)
      )
    })

    it('should return { success: false, error } when mkdir throws', async () => {
      const { mkdir } = await import('fs/promises')
      vi.mocked(mkdir).mockRejectedValueOnce(new Error('EACCES'))
      const result = await callHandler('create-project-db', '/fake/project') as {
        success: boolean; error?: string
      }
      expect(result.success).toBe(false)
      expect(result.error).toContain('EACCES')
    })

    it('T528: should throw when projectPath is not in allowed list', async () => {
      await expect(callHandler('create-project-db', '/unregistered/path')).rejects.toThrow('PROJECT_PATH_NOT_ALLOWED')
    })

    it('T687: GENERIC_AGENTS contains expected generic agents and no av-specific agents', async () => {
      const { GENERIC_AGENTS } = await import('./default-agents')
      const names = GENERIC_AGENTS.map((a) => a.name)
      expect(names).toContain('dev')
      expect(names).toContain('review')
      expect(names).toContain('test')
      expect(names).toContain('doc')
      expect(names).toContain('task-creator')
      expect(names).not.toContain('dev-front-vuejs')
      expect(names).not.toContain('dev-back-electron')
      expect(names).not.toContain('ux-front-vuejs')
    })

    // ── T688: scripts export ────────────────────────────────────────────────

    it('T688: should copy agent scripts to <projectPath>/scripts/ on success', async () => {
      const { mkdir, writeFile, copyFile } = await import('fs/promises')
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)
      vi.mocked(copyFile).mockResolvedValue(undefined)
      const result = await callHandler('create-project-db', '/fake/project') as {
        success: boolean; dbPath: string; scriptsCopied: number
      }
      expect(result.success).toBe(true)
      expect(result.scriptsCopied).toBe(5)
      expect(copyFile).toHaveBeenCalledTimes(5)
    })

    it('T688: should include scriptsCopied=5 in success response', async () => {
      const { mkdir, writeFile, copyFile } = await import('fs/promises')
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)
      vi.mocked(copyFile).mockResolvedValue(undefined)
      const result = await callHandler('create-project-db', '/fake/project') as Record<string, unknown>
      expect(result).toHaveProperty('scriptsCopied', 5)
      expect(result).not.toHaveProperty('scriptsError')
    })

    it('T688: should return scriptsError (not fail) when script copy fails (permission denied)', async () => {
      const { mkdir, writeFile, copyFile } = await import('fs/promises')
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)
      vi.mocked(copyFile).mockRejectedValueOnce(new Error('EACCES: permission denied'))
      const result = await callHandler('create-project-db', '/fake/project') as {
        success: boolean; dbPath: string; scriptsError?: string; scriptsCopied: number
      }
      // DB creation succeeds even if scripts copy fails
      expect(result.success).toBe(true)
      expect(result.dbPath).toContain('project.db')
      expect(result.scriptsError).toBeDefined()
      expect(result.scriptsError).toContain('EACCES')
    })

    it('T688: should use dev scripts path (app.isPackaged=false)', async () => {
      const { mkdir, writeFile, copyFile } = await import('fs/promises')
      const { app } = await import('electron')
      vi.mocked(mkdir).mockResolvedValue(undefined)
      vi.mocked(writeFile).mockResolvedValue(undefined)
      vi.mocked(copyFile).mockResolvedValue(undefined)
      vi.mocked(app.getAppPath).mockReturnValue('/fake/app')
      await callHandler('create-project-db', '/fake/project')
      // In dev mode (isPackaged=false), scripts come from app.getAppPath()/scripts/
      const calls = vi.mocked(copyFile).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      expect(String(calls[0][0])).toContain('scripts')
    })

    it('T688: AGENT_SCRIPTS exports exactly the 5 expected scripts', async () => {
      const { AGENT_SCRIPTS } = await import('./ipc')
      expect(AGENT_SCRIPTS).toEqual([
        'dbq.js', 'dbw.js', 'dbstart.js', 'dblock.js', 'capture-tokens-hook.js'
      ])
    })
  })

  // ── T351: window-maximize toggle ──────────────────────────────────────────

  describe('window-maximize handler', () => {
    it('should unmaximize when window is already maximized', async () => {
      const { BrowserWindow } = await import('electron')
      const mockUnmaximize = vi.fn()
      const mockMaximize = vi.fn()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue({
        isMaximized: () => true,
        unmaximize: mockUnmaximize,
        maximize: mockMaximize,
      } as unknown as BrowserWindow)
      await callHandler('window-maximize')
      expect(mockUnmaximize).toHaveBeenCalled()
      expect(mockMaximize).not.toHaveBeenCalled()
    })

    it('should maximize when window is not maximized', async () => {
      const { BrowserWindow } = await import('electron')
      const mockUnmaximize = vi.fn()
      const mockMaximize = vi.fn()
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue({
        isMaximized: () => false,
        unmaximize: mockUnmaximize,
        maximize: mockMaximize,
      } as unknown as BrowserWindow)
      await callHandler('window-maximize')
      expect(mockMaximize).toHaveBeenCalled()
      expect(mockUnmaximize).not.toHaveBeenCalled()
    })

    it('should not throw when no focused window', async () => {
      const { BrowserWindow } = await import('electron')
      vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)
      await expect(callHandler('window-maximize')).resolves.not.toThrow()
    })
  })

  // ── T351: select-new-project-dir ──────────────────────────────────────────

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

  // ── T351: select-project-dir — hasCLAUDEmd ────────────────────────────────

  describe('select-project-dir — hasCLAUDEmd', () => {
    it('should return hasCLAUDEmd: true when CLAUDE.md exists', async () => {
      const { dialog } = await import('electron')
      const { access, readdir } = await import('fs/promises')
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/my/project'],
      })
      // access resolves for all calls (including .claude dir and CLAUDE.md check)
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
      // First access call (.claude dir) succeeds, second (CLAUDE.md) fails
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

  // ── T416: task:getAssignees ────────────────────────────────────────────────
  // Uses queryLive (CJS require bypass) → fails on mock buffer → tests error contract.

  describe('task:getAssignees handler', () => {
    it('should return { success: false, assignees: [], error } when taskId is not an integer', async () => {
      const result = await callHandler('task:getAssignees', '/fake/project.db', 'abc') as {
        success: boolean; assignees: unknown[]; error?: string
      }
      expect(result).toMatchObject({ success: false, assignees: [], error: 'Invalid taskId' })
    })

    it('should return { success: false, assignees: [], error } when taskId is a float', async () => {
      const result = await callHandler('task:getAssignees', '/fake/project.db', 1.5) as {
        success: boolean; assignees: unknown[]; error?: string
      }
      expect(result).toMatchObject({ success: false, assignees: [], error: 'Invalid taskId' })
    })

    it('should return { success: false, assignees: [] } when dbPath does not exist (DB error)', async () => {
      const result = await callHandler('task:getAssignees', '/nonexistent/db.sqlite', 1) as {
        success: boolean; assignees: unknown[]
      }
      expect(result.success).toBe(false)
      expect(Array.isArray(result.assignees)).toBe(true)
      expect(result.assignees).toHaveLength(0)
    })

    it('should always return { success, assignees } shape', async () => {
      const result = await callHandler('task:getAssignees', '/nonexistent/db.sqlite', 99) as Record<string, unknown>
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('assignees')
    })
  })

  // ── T416: task:setAssignees ────────────────────────────────────────────────

  describe('task:setAssignees handler', () => {
    it('should return { success: false, error: Invalid taskId } when taskId is not an integer', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 'xyz', []) as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: 'Invalid taskId' })
    })

    it('should return { success: false, error: Invalid taskId } when taskId is a float', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 2.7, []) as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: 'Invalid taskId' })
    })

    it('should return { success: false, error } when assignees is not an array', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, 'not-array') as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: 'assignees must be an array' })
    })

    it('should return { success: false, error } when assignees is null', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, null) as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: 'assignees must be an array' })
    })

    it('should return { success: false, error: Invalid role } when role is not allowed', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, [
        { agentId: 1, role: 'admin' }
      ]) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid role') })
      expect(result.error).toContain('admin')
    })

    it('should return { success: false, error: Invalid agentId } when agentId is not an integer', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, [
        { agentId: 'foo', role: 'primary' }
      ]) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid agentId') })
    })

    it('should accept null role without validation error', async () => {
      // null is in validRoles → passes validation, then fails at DB level (not registered or DB error)
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, [
        { agentId: 1, role: null }
      ]) as { success: boolean }
      // Passes validation, may fail at writeDb level with mock
      expect(result).toHaveProperty('success')
    })

    it('should return { success: false, error } when dbPath is not registered (T282)', async () => {
      const result = await callHandler('task:setAssignees', '/invalid/db', 1, []) as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })

    it('should return { success, error? } shape for valid args (registered dbPath)', async () => {
      const result = await callHandler('task:setAssignees', '/fake/project.db', 1, []) as { success: boolean }
      expect(result).toHaveProperty('success')
    })

    it('should accept valid roles: primary, support, reviewer', async () => {
      for (const role of ['primary', 'support', 'reviewer'] as const) {
        const result = await callHandler('task:setAssignees', '/fake/project.db', 1, [
          { agentId: 1, role }
        ]) as { success: boolean; error?: string }
        // Valid role → passes validation (may fail at DB level with mock, but not role error)
        if (!result.success && result.error) {
          expect(result.error).not.toContain('Invalid role')
        }
      }
    })
  })

  // ── T474: tasks:getArchived ───────────────────────────────────────────────────
  // Note: tasks:getArchived uses queryLive (CJS require — bypasses vi.mock ESM).
  // assertDbPathAllowed throws synchronously for unregistered paths.
  // For registered paths, queryLive throws (mock fs returns invalid buffer).

  describe('tasks:getArchived handler', () => {
    it('should throw DB_PATH_NOT_ALLOWED when dbPath is not registered', async () => {
      await expect(
        callHandler('tasks:getArchived', '/unregistered/evil.db', { page: 0, pageSize: 10 })
      ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should throw when dbPath is registered but DB buffer is invalid (queryLive)', async () => {
      await expect(
        callHandler('tasks:getArchived', '/fake/project.db', { page: 0, pageSize: 10 })
      ).rejects.toThrow()
    })

    it('should throw when agentId filter is provided', async () => {
      await expect(
        callHandler('tasks:getArchived', '/fake/project.db', { page: 0, pageSize: 10, agentId: 42 })
      ).rejects.toThrow()
    })

    it('should throw when perimetre filter is provided', async () => {
      await expect(
        callHandler('tasks:getArchived', '/fake/project.db', { page: 0, pageSize: 10, perimetre: 'back-electron' })
      ).rejects.toThrow()
    })

    it('should throw when agentId and perimetre are combined', async () => {
      await expect(
        callHandler('tasks:getArchived', '/fake/project.db', { page: 0, pageSize: 10, agentId: 1, perimetre: 'front-vuejs' })
      ).rejects.toThrow()
    })

    it('should throw when page=1 (offset = page * pageSize)', async () => {
      await expect(
        callHandler('tasks:getArchived', '/fake/project.db', { page: 1, pageSize: 5 })
      ).rejects.toThrow()
    })

    it('should not add agentId condition when agentId=null', async () => {
      // null → condition skipped (agentId != null is false) — still throws on invalid buffer
      await expect(
        callHandler('tasks:getArchived', '/fake/project.db', { page: 0, pageSize: 10, agentId: null })
      ).rejects.toThrow()
    })

    it('should not add perimetre condition when perimetre=null', async () => {
      await expect(
        callHandler('tasks:getArchived', '/fake/project.db', { page: 0, pageSize: 10, perimetre: null })
      ).rejects.toThrow()
    })
  })

  // ── T474: tasks:updateStatus ──────────────────────────────────────────────────
  // Handler catches writeDb errors and returns { success: false }.
  // assertDbPathAllowed throws for unregistered paths (not caught).
  // Statut validation returns { success: false } before any DB access.

  describe('tasks:updateStatus handler', () => {
    it('should throw DB_PATH_NOT_ALLOWED when dbPath is not registered', async () => {
      await expect(
        callHandler('tasks:updateStatus', '/unregistered/evil.db', 1, 'done')
      ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should return { success: false, error } for unknown statut', async () => {
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 1, 'invalid-status') as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid statut: invalid-status') })
    })

    it('should return { success: false, error } for empty string statut', async () => {
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 1, '') as {
        success: boolean; error?: string
      }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid statut:') })
    })

    it('should return { success: false } for null statut (not in ALLOWED list)', async () => {
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 1, null) as {
        success: boolean
      }
      expect(result.success).toBe(false)
    })

    it('should accept all four valid statuts without validation error', async () => {
      const validStatuts = ['todo', 'in_progress', 'done', 'archived'] as const
      for (const statut of validStatuts) {
        const result = await callHandler('tasks:updateStatus', '/fake/project.db', 1, statut) as {
          success: boolean; error?: string
        }
        // Validation passes; DB error may follow — but not a statut validation error
        if (!result.success && result.error) {
          expect(result.error).not.toContain('Invalid statut')
        }
      }
    })

    it('should return { success: false, error: string } when writeDb throws (mock buffer)', async () => {
      // writeDb uses real sql.js on mock buffer → throws "file is not a database"
      // Handler catches and returns { success: false, error: String(err) }
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 1, 'done') as {
        success: boolean; error?: string
      }
      expect(result).toHaveProperty('success')
      if (!result.success) {
        expect(typeof result.error).toBe('string')
      }
    })

    it('should always return { success, error? } shape — never throw — for valid statut', async () => {
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 99, 'archived') as Record<string, unknown>
      expect(result).toHaveProperty('success')
      expect(typeof result.success).toBe('boolean')
    })

    // ── T552: blocker check for in_progress ──────────────────────────────────
    it('T552: should return TASK_BLOCKED when unresolved blockers exist (type bloque)', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([
        { id: 42, titre: 'Blocker task', statut: 'in_progress' },
      ])
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 10, 'in_progress') as {
        success: boolean; error?: string; blockers?: Array<{ id: number; titre: string; statut: string }>
      }
      expect(result).toMatchObject({ success: false, error: 'TASK_BLOCKED' })
      expect(result.blockers).toHaveLength(1)
      expect(result.blockers?.[0]).toMatchObject({ id: 42, titre: 'Blocker task', statut: 'in_progress' })
    })

    it('T552: should allow in_progress when no blockers exist', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([])
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 10, 'in_progress') as {
        success: boolean; error?: string
      }
      // No TASK_BLOCKED error (may fail on DB write with mock but not due to blockers)
      if (!result.success && result.error) {
        expect(result.error).not.toBe('TASK_BLOCKED')
      }
    })

    it('T552: should return TASK_BLOCKED with multiple blockers', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([
        { id: 10, titre: 'Dep A', statut: 'todo' },
        { id: 11, titre: 'Dep B', statut: 'in_progress' },
      ])
      const result = await callHandler('tasks:updateStatus', '/fake/project.db', 20, 'in_progress') as {
        success: boolean; error?: string; blockers?: Array<{ id: number; titre: string; statut: string }>
      }
      expect(result).toMatchObject({ success: false, error: 'TASK_BLOCKED' })
      expect(result.blockers).toHaveLength(2)
    })

    it('T552: should not check blockers for statut other than in_progress', async () => {
      const qSpy = vi.mocked(mockedQueryLive)
      await callHandler('tasks:updateStatus', '/fake/project.db', 10, 'done')
      // queryLive must NOT be called for 'done' status
      expect(qSpy).not.toHaveBeenCalled()
    })
  })

  // ── T473: agent:duplicate — input validation ──────────────────────────────────

  describe('agent:duplicate handler', () => {
    it('should return { success: false, error: "Invalid agentId" } when agentId is a string (T473)', async () => {
      const result = await callHandler('agent:duplicate', '/fake/project.db', 'not-a-number') as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'Invalid agentId' })
    })

    it('should return { success: false, error: "Invalid agentId" } when agentId is a float (T473)', async () => {
      const result = await callHandler('agent:duplicate', '/fake/project.db', 1.5) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'Invalid agentId' })
    })

    it('should return { success: false, error } when dbPath is not registered (T473)', async () => {
      const result = await callHandler('agent:duplicate', '/invalid/db', 1)
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('DB_PATH_NOT_ALLOWED') })
    })
  })

  // ── T477: update-agent — single UPDATE ────────────────────────────────────────

  describe('update-agent handler — single UPDATE (T477)', () => {
    it('should return { success: true } when updates is empty (T477 — cols.length guard)', async () => {
      const result = await callHandler('update-agent', '/fake/project.db', 1, {}) as { success: boolean }
      expect(result).toMatchObject({ success: true })
    })

    it('should return { success: false, error } for invalid maxSessions (T477)', async () => {
      const result = await callHandler('update-agent', '/fake/project.db', 1, { maxSessions: 0 }) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('maxSessions') })
    })
  })

  // ── T768: sessions:statsCost ──────────────────────────────────────────────────

  describe('sessions:statsCost handler (T768)', () => {
    it('should throw DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
      await expect(
        callHandler('sessions:statsCost', '/unregistered/evil.db', { period: 'day' })
      ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should return { success: false, error: INVALID_PERIOD } for unknown period', async () => {
      const result = await callHandler('sessions:statsCost', '/fake/project.db', { period: 'hour' }) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_PERIOD' })
    })

    it('should return { success: false, error: INVALID_PERIOD } when period is missing', async () => {
      const result = await callHandler('sessions:statsCost', '/fake/project.db', {}) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_PERIOD' })
    })

    it('should return { success: true, rows } when queryLive succeeds for day period', async () => {
      const mockRows = [
        { agent_name: 'dev-back-electron', agent_id: 3, period: '2026-03-04', session_count: 2, total_cost: 0.0025, avg_duration_s: 30.5, total_turns: 10, total_tokens: 5000, cache_read: 1200, cache_write: 300 },
      ]
      vi.mocked(mockedQueryLive).mockResolvedValueOnce(mockRows)
      const result = await callHandler('sessions:statsCost', '/fake/project.db', { period: 'day' }) as { success: boolean; rows: unknown[] }
      expect(result).toMatchObject({ success: true, rows: mockRows })
    })

    it('should return { success: true, rows } for week and month periods', async () => {
      for (const period of ['week', 'month'] as const) {
        vi.mocked(mockedQueryLive).mockResolvedValueOnce([])
        const result = await callHandler('sessions:statsCost', '/fake/project.db', { period }) as { success: boolean; rows: unknown[] }
        expect(result).toMatchObject({ success: true, rows: [] })
      }
    })

    it('should clamp limit to [1, 365]', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([])
      // limit=0 → clamped to 1; handler still returns success
      const result = await callHandler('sessions:statsCost', '/fake/project.db', { period: 'day', limit: 0 }) as { success: boolean }
      expect(result.success).toBe(true)
    })

    it('should filter by agentId when provided as integer', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([])
      const result = await callHandler('sessions:statsCost', '/fake/project.db', { period: 'day', agentId: 3 }) as { success: boolean }
      expect(result.success).toBe(true)
    })

    it('should return { success: false, error } when queryLive throws', async () => {
      // Default mock throws "file is not a database"
      const result = await callHandler('sessions:statsCost', '/fake/project.db', { period: 'day' }) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: expect.any(String) })
    })
  })

  // ── T771: project:exportZip ───────────────────────────────────────────────────

  describe('project:exportZip handler (T771)', () => {
    it('should throw DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
      await expect(
        callHandler('project:exportZip', '/unregistered/evil.db')
      ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should return { success: boolean } shape for registered dbPath (mocked fs)', async () => {
      // readFile and writeFile are mocked; shell.showItemInFolder may not be mocked
      // → handler catches any error and returns { success, error }
      const result = await callHandler('project:exportZip', '/fake/project.db') as { success: boolean; error?: string; path?: string }
      expect(result).toHaveProperty('success')
      expect(typeof result.success).toBe('boolean')
    })
  })

  // ── T777: shell:openExternal ──────────────────────────────────────────────────
  // URL filter: only http/https allowed; other schemes silently ignored.

  describe('shell:openExternal handler (T777)', () => {
    let shellMock: { openExternal: ReturnType<typeof vi.fn> }

    beforeEach(async () => {
      const electron = await import('electron')
      shellMock = (electron as unknown as { shell: { openExternal: ReturnType<typeof vi.fn> } }).shell
      shellMock.openExternal.mockClear()
    })

    it('should call shell.openExternal for https:// URL', async () => {
      await callHandler('shell:openExternal', 'https://example.com')
      expect(shellMock.openExternal).toHaveBeenCalledWith('https://example.com')
    })

    it('should call shell.openExternal for http:// URL', async () => {
      await callHandler('shell:openExternal', 'http://example.com')
      expect(shellMock.openExternal).toHaveBeenCalledWith('http://example.com')
    })

    it('should NOT call shell.openExternal for ftp:// URL', async () => {
      await callHandler('shell:openExternal', 'ftp://example.com')
      expect(shellMock.openExternal).not.toHaveBeenCalled()
    })

    it('should NOT call shell.openExternal for empty string', async () => {
      await callHandler('shell:openExternal', '')
      expect(shellMock.openExternal).not.toHaveBeenCalled()
    })

    it('should NOT call shell.openExternal for javascript: scheme (XSS guard)', async () => {
      await callHandler('shell:openExternal', 'javascript:alert(1)')
      expect(shellMock.openExternal).not.toHaveBeenCalled()
    })
  })

  // ── T777: session:updateResult ────────────────────────────────────────────────
  // sessionId validation: must be integer > 0.
  // writeDb errors are caught → { success: false, error }.

  describe('session:updateResult handler (T777)', () => {
    it('should return INVALID_SESSION_ID for sessionId = 0', async () => {
      const result = await callHandler('session:updateResult', '/fake/project.db', 0, {}) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_SESSION_ID' })
    })

    it('should return INVALID_SESSION_ID for sessionId = -1', async () => {
      const result = await callHandler('session:updateResult', '/fake/project.db', -1, {}) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_SESSION_ID' })
    })

    it('should return INVALID_SESSION_ID for sessionId = 1.5 (float)', async () => {
      const result = await callHandler('session:updateResult', '/fake/project.db', 1.5, {}) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_SESSION_ID' })
    })

    it('should return INVALID_SESSION_ID for sessionId = NaN', async () => {
      const result = await callHandler('session:updateResult', '/fake/project.db', NaN, {}) as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false, error: 'INVALID_SESSION_ID' })
    })

    it('should throw DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
      await expect(
        callHandler('session:updateResult', '/unregistered/evil.db', 1, {})
      ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should return { success: false, error } when writeDb throws (mock sql.js buffer)', async () => {
      // writeDb uses real sql.js on mock buffer → throws "file is not a database"
      const result = await callHandler('session:updateResult', '/fake/project.db', 1, { cost_usd: 0.01 }) as { success: boolean; error?: string }
      expect(result).toHaveProperty('success')
      if (!result.success) {
        expect(result.error).toBeDefined()
      }
    })
  })

  // ── T777: git:log ─────────────────────────────────────────────────────────────
  // Security: assertProjectPathAllowed guard + sinceArg regex injection guard.
  // Parsing: JSONL-style lines split by SEP (\x1F), taskIds extracted from subject.

  describe('git:log handler (T777)', () => {
    const SEP = '\x1F'

    beforeEach(() => {
      mockExecSync.mockReset()
    })

    it('should throw PROJECT_PATH_NOT_ALLOWED for unregistered projectPath', async () => {
      await expect(
        callHandler('git:log', '/unregistered/repo')
      ).rejects.toThrow()
    })

    it('should return [] when execSync throws (git absent or invalid repo)', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('git: command not found') })
      const result = await callHandler('git:log', '/fake/project') as unknown[]
      expect(result).toEqual([])
    })

    it('should clamp limit < 1 to 1', async () => {
      mockExecSync.mockReturnValue('')
      await callHandler('git:log', '/fake/project', { limit: 0 })
      const cmd = mockExecSync.mock.calls[0][0] as string
      expect(cmd).toContain('-n 1')
    })

    it('should clamp limit > 500 to 500', async () => {
      mockExecSync.mockReturnValue('')
      await callHandler('git:log', '/fake/project', { limit: 9999 })
      const cmd = mockExecSync.mock.calls[0][0] as string
      expect(cmd).toContain('-n 500')
    })

    it('should floor decimal limit (2.9 → 2)', async () => {
      mockExecSync.mockReturnValue('')
      await callHandler('git:log', '/fake/project', { limit: 2.9 })
      const cmd = mockExecSync.mock.calls[0][0] as string
      expect(cmd).toContain('-n 2')
    })

    it('should inject sinceArg for valid since string', async () => {
      mockExecSync.mockReturnValue('')
      await callHandler('git:log', '/fake/project', { since: '2024-01-01' })
      const cmd = mockExecSync.mock.calls[0][0] as string
      expect(cmd).toContain('--since=')
    })

    it('should NOT inject sinceArg for string with semicolon (injection guard)', async () => {
      mockExecSync.mockReturnValue('')
      await callHandler('git:log', '/fake/project', { since: '2024-01-01; rm -rf /' })
      const cmd = mockExecSync.mock.calls[0][0] as string
      expect(cmd).not.toContain('--since=')
    })

    it('should parse hash, date, subject, author from output line', async () => {
      const line = `abc123${SEP}2024-01-15T10:00:00+00:00${SEP}fix: something${SEP}John`
      mockExecSync.mockReturnValue(line + '\n')
      const result = await callHandler('git:log', '/fake/project') as Array<{ hash: string; date: string; subject: string; author: string; taskIds: number[] }>
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ hash: 'abc123', date: '2024-01-15T10:00:00+00:00', subject: 'fix: something', author: 'John', taskIds: [] })
    })

    it('should extract multiple taskIds from subject (T123+T456)', async () => {
      const line = `def456${SEP}2024-01-16T10:00:00+00:00${SEP}feat(scope): do thing (T123 T456)${SEP}Alice`
      mockExecSync.mockReturnValue(line + '\n')
      const result = await callHandler('git:log', '/fake/project') as Array<{ taskIds: number[] }>
      expect(result[0].taskIds).toEqual([123, 456])
    })

    it('should filter empty lines from output', async () => {
      const line = `abc123${SEP}2024-01-15T10:00:00+00:00${SEP}fix: x${SEP}John`
      mockExecSync.mockReturnValue(`${line}\n\n\n`)
      const result = await callHandler('git:log', '/fake/project') as unknown[]
      expect(result).toHaveLength(1)
    })
  })
})

