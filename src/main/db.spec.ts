/**
 * Tests for DB infrastructure — src/main/db.ts (T1157)
 *
 * Covers: connection pool, clearDbCacheEntry, registerDbPath/assertDbPathAllowed,
 * registerProjectPath/assertProjectPathAllowed, writeDb, queryLive,
 * migrateDb, FORBIDDEN_WRITE_PATTERN.
 *
 * Framework: Vitest (node environment)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve } from 'path'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockAcquireWriteLock = vi.fn().mockResolvedValue('/test/project.db.wlock')
const mockReleaseWriteLock = vi.fn().mockResolvedValue(undefined)

vi.mock('./db-lock', () => ({
  acquireWriteLock: (...args: unknown[]) => mockAcquireWriteLock(...args),
  releaseWriteLock: (...args: unknown[]) => mockReleaseWriteLock(...args),
}))

const mockCopyFile = vi.fn().mockResolvedValue(undefined)
const mockUnlink = vi.fn().mockResolvedValue(undefined)

vi.mock('fs/promises', () => ({
  default: {
    copyFile: (...args: unknown[]) => mockCopyFile(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
  copyFile: (...args: unknown[]) => mockCopyFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}))

// Mock migration module — db.ts delegates all migration logic to migration.ts
const mockApplyMigrations = vi.fn(() => 0)

vi.mock('./migration', () => ({
  migrateDb: (...args: unknown[]) => mockApplyMigrations(...args),
  CURRENT_SCHEMA_VERSION: 19,
}))

// Mock better-sqlite3
const mockPragma = vi.fn().mockReturnValue('wal')
const mockPrepare = vi.fn()
const mockExec = vi.fn()
const mockClose = vi.fn()

const mockDbInstance = {
  pragma: mockPragma,
  prepare: mockPrepare,
  exec: mockExec,
  close: mockClose,
}

vi.mock('better-sqlite3', () => ({
  default: function MockDatabase() { return mockDbInstance },
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  clearDbCacheEntry,
  registerDbPath,
  assertDbPathAllowed,
  registerProjectPath,
  assertProjectPathAllowed,
  writeDb,
  queryLive,
  FORBIDDEN_WRITE_PATTERN,
} from './db'

// ── Tests ─────────────────────────────────────────────────────────────────────

// ── registerDbPath / assertDbPathAllowed ──────────────────────────────────────

describe('registerDbPath / assertDbPathAllowed (T282)', () => {
  it('should allow a registered path', () => {
    const p = '/tmp/test-register-db-' + Date.now() + '.db'
    registerDbPath(p)
    expect(() => assertDbPathAllowed(p)).not.toThrow()
  })

  it('should throw on unregistered path', () => {
    expect(() => assertDbPathAllowed('/never/registered.db'))
      .toThrow('DB_PATH_NOT_ALLOWED')
  })

  it('should resolve paths before comparing', () => {
    const p = '/tmp/./foo/../bar.db'
    registerDbPath(p)
    // resolve normalizes the path
    expect(() => assertDbPathAllowed(resolve(p))).not.toThrow()
  })

  it('should ignore null/undefined input to registerDbPath', () => {
    // Should not throw
    registerDbPath(null)
    registerDbPath(undefined)
  })

  it('should throw on empty string', () => {
    expect(() => assertDbPathAllowed('')).toThrow('DB_PATH_NOT_ALLOWED')
  })
})

// ── registerProjectPath / assertProjectPathAllowed ───────────────────────────

describe('registerProjectPath / assertProjectPathAllowed (T283)', () => {
  it('should allow a registered project path', () => {
    const p = '/tmp/test-project-' + Date.now()
    registerProjectPath(p)
    expect(() => assertProjectPathAllowed(p)).not.toThrow()
  })

  it('should throw on unregistered project path', () => {
    expect(() => assertProjectPathAllowed('/never/registered/project'))
      .toThrow('PROJECT_PATH_NOT_ALLOWED')
  })

  it('should resolve paths before comparing', () => {
    const p = '/tmp/./proj/../proj-resolved'
    registerProjectPath(p)
    expect(() => assertProjectPathAllowed(resolve(p))).not.toThrow()
  })

  it('should ignore null/undefined input to registerProjectPath', () => {
    registerProjectPath(null)
    registerProjectPath(undefined)
  })

  it('should throw on empty string', () => {
    expect(() => assertProjectPathAllowed('')).toThrow('PROJECT_PATH_NOT_ALLOWED')
  })
})

// ── writeDb ──────────────────────────────────────────────────────────────────

describe('writeDb (T1157)', () => {
  const dbPath = '/test/write-test.db'

  beforeEach(() => {
    vi.clearAllMocks()
    clearDbCacheEntry(dbPath)
    mockAcquireWriteLock.mockResolvedValue(dbPath + '.wlock')
    mockReleaseWriteLock.mockResolvedValue(undefined)
  })

  it('should call fn with a MigrationDb adapter and return result', async () => {
    const fn = vi.fn(() => 'result-value')
    const result = await writeDb(dbPath, fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(result).toBe('result-value')
    // Should acquire cross-process lock before write
    expect(mockAcquireWriteLock).toHaveBeenCalledWith(dbPath)
    expect(mockReleaseWriteLock).toHaveBeenCalledWith(dbPath + '.wlock')
  })

  it('should execute concurrent writes sequentially (mutex)', async () => {
    const order: number[] = []
    const fn1 = vi.fn(() => {
      order.push(1)
      return 'first'
    })
    const fn2 = vi.fn(() => {
      order.push(2)
      return 'second'
    })

    const [r1, r2] = await Promise.all([
      writeDb(dbPath, fn1),
      writeDb(dbPath, fn2),
    ])

    expect(r1).toBe('first')
    expect(r2).toBe('second')
    expect(order).toEqual([1, 2])
  })

  it('should release lock if fn throws', async () => {
    const fn = vi.fn(() => { throw new Error('mutation-failed') })

    await expect(writeDb(dbPath, fn)).rejects.toThrow('mutation-failed')
    expect(mockReleaseWriteLock).toHaveBeenCalledWith(dbPath + '.wlock')
  })
})

// ── queryLive ─────────────────────────────────────────────────────────────────

describe('queryLive (T1157)', () => {
  const dbPath = '/test/query-test.db'

  beforeEach(() => {
    vi.clearAllMocks()
    clearDbCacheEntry(dbPath)
  })

  it('should call prepare().all() on the pooled connection', async () => {
    const mockAll = vi.fn().mockReturnValue([{ id: 1, name: 'test' }])
    mockPrepare.mockReturnValue({ all: mockAll })

    const result = await queryLive(dbPath, 'SELECT * FROM agents', [])
    expect(mockPrepare).toHaveBeenCalledWith('SELECT * FROM agents')
    expect(result).toEqual([{ id: 1, name: 'test' }])
  })

  it('should spread params when provided', async () => {
    const mockAll = vi.fn().mockReturnValue([])
    mockPrepare.mockReturnValue({ all: mockAll })

    await queryLive(dbPath, 'SELECT * FROM agents WHERE id = ?', [42])
    expect(mockAll).toHaveBeenCalledWith(42)
  })

  it('should catch SQLITE_CORRUPT, clear pool entry via db.close(), and rethrow with SQLITE_CORRUPT code (T1760)', async () => {
    clearDbCacheEntry(dbPath)
    mockClose.mockClear()

    const corruptErr = Object.assign(new Error('database disk image is malformed'), { code: 'SQLITE_CORRUPT' })
    mockPrepare.mockReturnValue({ all: vi.fn().mockImplementation(() => { throw corruptErr }) })

    await expect(queryLive(dbPath, 'SELECT * FROM tasks', [])).rejects.toMatchObject({ code: 'SQLITE_CORRUPT' })
    expect(mockClose).toHaveBeenCalled()
  })
})

// ── FORBIDDEN_WRITE_PATTERN ─────────────────────────────────────────────────

describe('FORBIDDEN_WRITE_PATTERN', () => {
  it('should match write SQL keywords', () => {
    expect(FORBIDDEN_WRITE_PATTERN.test('INSERT INTO tasks')).toBe(true)
    expect(FORBIDDEN_WRITE_PATTERN.test('UPDATE tasks SET')).toBe(true)
    expect(FORBIDDEN_WRITE_PATTERN.test('DELETE FROM tasks')).toBe(true)
    expect(FORBIDDEN_WRITE_PATTERN.test('DROP TABLE tasks')).toBe(true)
  })

  it('should not match read-only SQL', () => {
    expect(FORBIDDEN_WRITE_PATTERN.test('SELECT * FROM tasks')).toBe(false)
    expect(FORBIDDEN_WRITE_PATTERN.test('PRAGMA table_info(tasks)')).toBe(false)
  })
})
