/**
 * Tests for DB-related IPC handlers — query-db, migrate-db, find-project-db,
 * get-locks, watch-db, unwatch-db.
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

// ── T552: mock ./db to intercept queryLive ────────────────────────────────────
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    queryLive: vi.fn().mockRejectedValue(new Error('file is not a database')),
  }
})
import { queryLive as mockedQueryLive } from './db'

// ── Import addDefaultLimit for unit testing ───────────────────────────────────
import { addDefaultLimit } from './ipc-db'

// ── Import ipc.ts AFTER mocks ─────────────────────────────────────────────────
import { registerIpcHandlers, registerDbPath, registerProjectPath } from './ipc'

// Helper to call a captured handler
async function callHandler(channel: string, ...args: unknown[]) {
  const handler = handlers[channel]
  if (!handler) throw new Error(`Handler not found: ${channel}. Available: ${Object.keys(handlers).join(', ')}`)
  return handler(null, ...args)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('IPC DB handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockedQueryLive).mockRejectedValue(new Error('file is not a database'))
    registerIpcHandlers()
    registerDbPath('/fake/project.db')
    registerDbPath('/fake/db')
    registerProjectPath('/fake/project')
    registerProjectPath('/empty/project')
    registerProjectPath('/my/project')
    registerProjectPath('/home/user/project')
    registerProjectPath('/allowed')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── query-db : FORBIDDEN_WRITE_KEYWORDS ────────────────────────────────────

  describe('query-db — write keyword enforcement', () => {
    const dbPath = '/fake/project.db'

    it('should block INSERT queries', async () => {
      const result = await callHandler('query-db', dbPath, "INSERT INTO tasks (title) VALUES ('hack')")
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Write operations'),
      })
    })

    it('should block UPDATE queries', async () => {
      const result = await callHandler('query-db', dbPath, "UPDATE tasks SET status='done' WHERE id=1")
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
      const result = await callHandler('query-db', dbPath, 'insert into tasks (title) values (1)')
      expect(result).toMatchObject({ success: false })
    })

    it('should allow SELECT queries past keyword check (throws on invalid db — not a keyword error)', async () => {
      await expect(callHandler('query-db', dbPath, 'SELECT * FROM tasks')).rejects.toThrow()
    })

    it('should reject unregistered dbPath with DB_PATH_NOT_ALLOWED (T354)', async () => {
      await expect(callHandler('query-db', '/unregistered/evil.db', 'SELECT 1'))
        .rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should document known limitation: INSERT in WHERE value is incorrectly blocked', async () => {
      const result = await callHandler('query-db', dbPath, "SELECT * FROM tasks WHERE title = 'INSERT something'", [])
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Write operations') })
    })
  })

  // ── query-db : params validation (T1178) ──────────────────────────────────

  describe('query-db — params validation (T1178)', () => {
    const dbPath = '/fake/project.db'

    it('should accept valid string param', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([])
      await expect(callHandler('query-db', dbPath, 'SELECT ? AS v', ['hello'])).resolves.toEqual([])
    })

    it('should accept valid number param', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([])
      await expect(callHandler('query-db', dbPath, 'SELECT ? AS v', [42])).resolves.toEqual([])
    })

    it('should accept valid boolean param', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([])
      await expect(callHandler('query-db', dbPath, 'SELECT ? AS v', [true])).resolves.toEqual([])
    })

    it('should accept null param', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([])
      await expect(callHandler('query-db', dbPath, 'SELECT ? AS v', [null])).resolves.toEqual([])
    })

    it('should accept Uint8Array param', async () => {
      vi.mocked(mockedQueryLive).mockResolvedValueOnce([])
      await expect(callHandler('query-db', dbPath, 'SELECT ? AS v', [new Uint8Array([1, 2, 3])])).resolves.toEqual([])
    })

    it('should reject plain object param', async () => {
      const result = await callHandler('query-db', dbPath, 'SELECT ? AS v', [{ evil: true }])
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid params') })
    })

    it('should reject function param', async () => {
      const result = await callHandler('query-db', dbPath, 'SELECT ? AS v', [() => 'crash'])
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid params') })
    })

    it('should reject Symbol param', async () => {
      const result = await callHandler('query-db', dbPath, 'SELECT ? AS v', [Symbol('evil')])
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid params') })
    })

    it('should reject non-array params (object)', async () => {
      const result = await callHandler('query-db', dbPath, 'SELECT 1', { length: 0 } as unknown as unknown[])
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid params') })
    })

    it('should reject object with throwing valueOf', async () => {
      const result = await callHandler('query-db', dbPath, 'SELECT ? AS v', [{ valueOf: () => { throw new Error('crash') } }])
      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Invalid params') })
    })
  })

  // ── query-db : SQLITE_CORRUPT handling (T1760) ──────────────────────────────

  describe('query-db — SQLITE_CORRUPT handling (T1760)', () => {
    const dbPath = '/fake/project.db'

    it('should return { success: false, error: DB_CORRUPT, rows: [] } when queryLive rejects with SQLITE_CORRUPT', async () => {
      const corruptErr = Object.assign(new Error('database disk image is malformed'), { code: 'SQLITE_CORRUPT' })
      vi.mocked(mockedQueryLive).mockRejectedValueOnce(corruptErr)

      const result = await callHandler('query-db', dbPath, 'SELECT * FROM tasks')
      expect(result).toMatchObject({ success: false, error: 'DB_CORRUPT', rows: [] })
    })

    it('should still throw for non-SQLITE_CORRUPT errors', async () => {
      const genericErr = new Error('some other db error')
      vi.mocked(mockedQueryLive).mockRejectedValueOnce(genericErr)

      await expect(callHandler('query-db', dbPath, 'SELECT * FROM tasks')).rejects.toThrow('some other db error')
    })
  })

  // ── migrate-db ────────────────────────────────────────────────────────────

  describe('migrate-db handler', () => {
    it('should return { success: false, error } on migration error', async () => {
      const result = await callHandler('migrate-db', '/fake/project.db') as { success: boolean; error?: string }
      expect(result).toMatchObject({ success: false })
      expect(typeof result.error).toBe('string')
    })

    it('should return object with success property', async () => {
      const result = await callHandler('migrate-db', '/nonexistent/path/project.db') as { success: boolean }
      expect(result).toHaveProperty('success')
      expect(typeof result.success).toBe('boolean')
    })
  })

  // ── find-project-db ────────────────────────────────────────────────────────

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

    it('T615: should return db path without self-registering the project path (T782)', async () => {
      const { access, readdir } = await import('fs/promises')
      vi.mocked(access).mockResolvedValue(undefined)
      vi.mocked(readdir as (path: string) => Promise<string[]>).mockResolvedValue(['project.db'])
      const result = await callHandler('find-project-db', '/cold-start/project')
      expect(result).toContain('project.db')
    })
  })

  // ── watch-db / unwatch-db ─────────────────────────────────────────────────

  describe('watch-db handler', () => {
    it('should reject unregistered dbPath with DB_PATH_NOT_ALLOWED (T355)', async () => {
      await expect(callHandler('watch-db', '/unregistered/evil.db'))
        .rejects.toThrow('DB_PATH_NOT_ALLOWED')
    })

    it('should call fs.watch on the parent directory (WAL-mode coverage)', async () => {
      const { watch } = await import('fs')
      vi.mocked(watch).mockClear()
      await callHandler('watch-db', '/fake/project.db')
      expect(watch).toHaveBeenCalledWith('/fake', { persistent: false }, expect.any(Function))
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

})
