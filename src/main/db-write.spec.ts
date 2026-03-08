/**
 * Tests for writeDb, queryLive, migrateDb, FORBIDDEN_WRITE_PATTERN (T349)
 *
 * Framework: Vitest (node environment)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockAcquireWriteLock = vi.fn().mockResolvedValue('/test/project.db.wlock')
const mockReleaseWriteLock = vi.fn().mockResolvedValue(undefined)

vi.mock('./db-lock', () => ({
  acquireWriteLock: (...args: unknown[]) => mockAcquireWriteLock(...args),
  releaseWriteLock: (...args: unknown[]) => mockReleaseWriteLock(...args),
}))

const mockStat = vi.fn()
const mockReadFile = vi.fn()
const mockWriteFile = vi.fn().mockResolvedValue(undefined)
const mockRename = vi.fn().mockResolvedValue(undefined)
const mockCopyFile = vi.fn().mockResolvedValue(undefined)
const mockUnlink = vi.fn().mockResolvedValue(undefined)

vi.mock('fs/promises', () => ({
  default: {
    stat: (...args: unknown[]) => mockStat(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    rename: (...args: unknown[]) => mockRename(...args),
    copyFile: (...args: unknown[]) => mockCopyFile(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
  stat: (...args: unknown[]) => mockStat(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  copyFile: (...args: unknown[]) => mockCopyFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}))

const mockApplyMigrations = vi.fn(() => 0)
const MOCK_CURRENT_SCHEMA_VERSION = 19

vi.mock('./migration', () => ({
  migrateDb: (...args: unknown[]) => mockApplyMigrations(...args),
  CURRENT_SCHEMA_VERSION: 19,
}))

vi.mock('sql.js', () => ({
  default: (...args: unknown[]) => vi.fn()(...args),
  __esModule: true,
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  clearDbCacheEntry,
  getSqlJs,
  writeDb,
  queryLive,
  migrateDb,
  FORBIDDEN_WRITE_PATTERN,
} from './db'

// ── writeDb ───────────────────────────────────────────────────────────────────

describe('writeDb (T313)', () => {
  const dbPath = '/test/write-test.db'
  const fakeBuffer = Buffer.from('fake-db')

  beforeEach(() => {
    vi.clearAllMocks()
    clearDbCacheEntry(dbPath)
    mockStat.mockResolvedValue({ mtimeMs: 1000 })
    mockReadFile.mockResolvedValue(fakeBuffer)
    mockAcquireWriteLock.mockResolvedValue(dbPath + '.wlock')
    mockReleaseWriteLock.mockResolvedValue(undefined)
  })

  it('should call fn with a db instance and write result to disk', async () => {
    const fn = vi.fn(() => 'result-value')
    const result = await writeDb(dbPath, fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(result).toBe('result-value')
    expect(mockAcquireWriteLock).toHaveBeenCalledWith(dbPath)
    expect(mockReleaseWriteLock).toHaveBeenCalledWith(dbPath + '.wlock')
    expect(mockWriteFile).toHaveBeenCalledWith(dbPath + '.tmp', expect.any(Buffer))
    expect(mockRename).toHaveBeenCalledWith(dbPath + '.tmp', dbPath)
  })

  it('should execute concurrent writes sequentially (mutex)', async () => {
    const order: number[] = []
    const fn1 = vi.fn(() => { order.push(1); return 'first' })
    const fn2 = vi.fn(() => { order.push(2); return 'second' })

    const [r1, r2] = await Promise.all([writeDb(dbPath, fn1), writeDb(dbPath, fn2)])

    expect(r1).toBe('first')
    expect(r2).toBe('second')
    expect(order).toEqual([1, 2])
  })

  it('should not rename if fn throws (rollback)', async () => {
    const fn = vi.fn(() => { throw new Error('mutation-failed') })
    await expect(writeDb(dbPath, fn)).rejects.toThrow('mutation-failed')
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('T1110: should skip export+write and return false when fn returns false', async () => {
    const fn = vi.fn(() => false as const)
    const result = await writeDb(dbPath, fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(result).toBe(false)
    expect(mockAcquireWriteLock).toHaveBeenCalledWith(dbPath)
    expect(mockReleaseWriteLock).toHaveBeenCalledWith(dbPath + '.wlock')
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockRename).not.toHaveBeenCalled()
  })
})

// ── queryLive ─────────────────────────────────────────────────────────────────

describe('queryLive', () => {
  const dbPath = '/test/write-query-test.db'

  beforeEach(() => {
    vi.clearAllMocks()
    clearDbCacheEntry(dbPath)
  })

  it('should return rows from a SELECT query', async () => {
    const sqlJs = await getSqlJs()
    const db = new sqlJs.Database()
    db.run('CREATE TABLE test (id INTEGER, val TEXT)')
    db.run("INSERT INTO test VALUES (1, 'hello')")
    db.run("INSERT INTO test VALUES (2, 'world')")
    const buf = Buffer.from(db.export())
    db.close()

    mockStat.mockResolvedValue({ mtimeMs: Date.now() })
    mockReadFile.mockResolvedValue(buf)

    const rows = await queryLive(dbPath, 'SELECT * FROM test', [])
    expect(rows).toEqual([
      { id: 1, val: 'hello' },
      { id: 2, val: 'world' },
    ])
  })

  it('should retry on "not a database" error then throw on second failure', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('not-a-real-db'))
    mockStat.mockResolvedValue({ mtimeMs: Date.now() })
    await expect(queryLive(dbPath, 'SELECT 1', [])).rejects.toThrow()
  })

  it('should propagate non-retryable errors immediately', async () => {
    const sqlJs = await getSqlJs()
    const db = new sqlJs.Database()
    const buf = Buffer.from(db.export())
    db.close()

    mockStat.mockResolvedValue({ mtimeMs: Date.now() })
    mockReadFile.mockResolvedValue(buf)

    await expect(queryLive(dbPath, 'SELECT * FROM nonexistent_table', []))
      .rejects.toThrow(/no such table/)
  })

  it('should release DB instance after DB_INSTANCE_TTL_MS (10s) but keep buffer (T910)', async () => {
    vi.useFakeTimers()
    try {
      const sqlJs = await getSqlJs()
      const db = new sqlJs.Database()
      db.run('CREATE TABLE t (id INTEGER)')
      db.run('INSERT INTO t VALUES (42)')
      const buf = Buffer.from(db.export())
      db.close()

      mockStat.mockResolvedValue({ mtimeMs: 9000 })
      mockReadFile.mockResolvedValue(buf)

      await queryLive(dbPath, 'SELECT * FROM t', [])
      expect(mockReadFile).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(15_000) // past DB_INSTANCE_TTL_MS, within CACHE_TTL_MS

      await queryLive(dbPath, 'SELECT * FROM t', [])
      expect(mockReadFile).toHaveBeenCalledTimes(1) // buffer not re-read
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── migrateDb ─────────────────────────────────────────────────────────────────

describe('migrateDb', () => {
  const dbPath = '/test/write-migrate-test.db'

  beforeEach(() => {
    vi.clearAllMocks()
    clearDbCacheEntry(dbPath)
    mockApplyMigrations.mockReturnValue(0)
    mockAcquireWriteLock.mockResolvedValue(dbPath + '.wlock')
    mockReleaseWriteLock.mockResolvedValue(undefined)
  })

  async function buildTestDbBuffer() {
    const sqlJs = await getSqlJs()
    const db = new sqlJs.Database()
    const buf = Buffer.from(db.export())
    db.close()
    return buf
  }

  async function buildCurrentVersionDbBuffer() {
    const sqlJs = await getSqlJs()
    const db = new sqlJs.Database()
    db.run(`PRAGMA user_version = ${MOCK_CURRENT_SCHEMA_VERSION}`)
    const buf = Buffer.from(db.export())
    db.close()
    return buf
  }

  it('should create backup before migration', async () => {
    mockReadFile.mockResolvedValue(await buildTestDbBuffer())

    await migrateDb(dbPath)

    expect(mockAcquireWriteLock).toHaveBeenCalledWith(dbPath)
    expect(mockCopyFile).toHaveBeenCalledWith(dbPath, `${dbPath}.bak`)
  })

  it('should delegate to migration.migrateDb', async () => {
    mockReadFile.mockResolvedValue(await buildTestDbBuffer())

    await migrateDb(dbPath)

    expect(mockApplyMigrations).toHaveBeenCalledWith(expect.any(Object))
  })

  it('should delete backup on success', async () => {
    mockReadFile.mockResolvedValue(await buildTestDbBuffer())

    await migrateDb(dbPath)

    expect(mockUnlink).toHaveBeenCalledWith(`${dbPath}.bak`)
  })

  it('should keep backup on failure', async () => {
    mockReadFile.mockResolvedValue(await buildTestDbBuffer())
    mockApplyMigrations.mockImplementation(() => { throw new Error('migration failed') })

    await expect(migrateDb(dbPath)).rejects.toThrow('migration failed')
    expect(mockUnlink).not.toHaveBeenCalled()
  })

  it('should return migrated count from migration.migrateDb', async () => {
    mockReadFile.mockResolvedValue(await buildTestDbBuffer())
    mockApplyMigrations.mockReturnValue(7)

    const result = await migrateDb(dbPath)
    expect(result).toEqual({ migrated: 7 })
  })

  it('T491: should skip migration entirely when user_version is already current', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() })
    mockReadFile.mockResolvedValue(await buildCurrentVersionDbBuffer())

    const result = await migrateDb(dbPath)

    expect(result).toEqual({ migrated: 0 })
    expect(mockCopyFile).not.toHaveBeenCalled()
    expect(mockApplyMigrations).not.toHaveBeenCalled()
    expect(mockAcquireWriteLock).not.toHaveBeenCalled()
  })
})

// ── FORBIDDEN_WRITE_PATTERN ───────────────────────────────────────────────────

describe('FORBIDDEN_WRITE_PATTERN', () => {
  it('should match write SQL keywords', () => {
    expect(FORBIDDEN_WRITE_PATTERN.test('INSERT INTO foo')).toBe(true)
    expect(FORBIDDEN_WRITE_PATTERN.test('UPDATE foo SET')).toBe(true)
    expect(FORBIDDEN_WRITE_PATTERN.test('DELETE FROM foo')).toBe(true)
    expect(FORBIDDEN_WRITE_PATTERN.test('DROP TABLE foo')).toBe(true)
    expect(FORBIDDEN_WRITE_PATTERN.test('ALTER TABLE foo')).toBe(true)
    expect(FORBIDDEN_WRITE_PATTERN.test('CREATE TABLE foo')).toBe(true)
    expect(FORBIDDEN_WRITE_PATTERN.test('TRUNCATE foo')).toBe(true)
    expect(FORBIDDEN_WRITE_PATTERN.test('REPLACE INTO foo')).toBe(true)
  })

  it('should match case-insensitively', () => {
    expect(FORBIDDEN_WRITE_PATTERN.test('insert into foo')).toBe(true)
    expect(FORBIDDEN_WRITE_PATTERN.test('Insert Into Foo')).toBe(true)
  })

  it('should not match SELECT queries', () => {
    expect(FORBIDDEN_WRITE_PATTERN.test('SELECT * FROM foo')).toBe(false)
    expect(FORBIDDEN_WRITE_PATTERN.test('SELECT count(*) FROM bar')).toBe(false)
  })
})
