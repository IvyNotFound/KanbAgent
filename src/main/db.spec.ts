/**
 * Tests for DB infrastructure — src/main/db.ts (T349)
 *
 * Covers: getDbBuffer cache, clearDbCacheEntry, registerDbPath/assertDbPathAllowed,
 * registerProjectPath/assertProjectPathAllowed, getSqlJs, writeDb, queryLive,
 * migrateDb, encryptToken/decryptToken, FORBIDDEN_WRITE_PATTERN.
 *
 * Framework: Vitest (node environment)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolve } from 'path'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockIsEncryptionAvailable = vi.fn(() => false)
const mockEncryptString = vi.fn()
const mockDecryptString = vi.fn()

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: (...args: unknown[]) => mockIsEncryptionAvailable(...args),
    encryptString: (...args: unknown[]) => mockEncryptString(...args),
    decryptString: (...args: unknown[]) => mockDecryptString(...args),
  },
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

// Mock all migration functions
const mockRunTaskStatusMigration = vi.fn(() => 0)
const mockRunAddPriorityMigration = vi.fn(() => false)
const mockRunTaskStatutI18nMigration = vi.fn(() => 0)
const mockRunAddConvIdToSessionsMigration = vi.fn(() => false)
const mockRunAddTokensToSessionsMigration = vi.fn(() => 0)
const mockRunRemoveThinkingModeBudgetTokensMigration = vi.fn(() => false)
const mockRunDropCommentaireColumnMigration = vi.fn(() => 0)
const mockRunSessionStatutI18nMigration = vi.fn(() => 0)
const mockRunMakeAgentAssigneNotNullMigration = vi.fn(() => false)
const mockRunMakeCommentAgentNotNullMigration = vi.fn(() => false)

vi.mock('./migration', () => ({
  runTaskStatusMigration: (...args: unknown[]) => mockRunTaskStatusMigration(...args),
  runAddPriorityMigration: (...args: unknown[]) => mockRunAddPriorityMigration(...args),
  runTaskStatutI18nMigration: (...args: unknown[]) => mockRunTaskStatutI18nMigration(...args),
  runAddConvIdToSessionsMigration: (...args: unknown[]) => mockRunAddConvIdToSessionsMigration(...args),
  runAddTokensToSessionsMigration: (...args: unknown[]) => mockRunAddTokensToSessionsMigration(...args),
  runRemoveThinkingModeBudgetTokensMigration: (...args: unknown[]) => mockRunRemoveThinkingModeBudgetTokensMigration(...args),
  runDropCommentaireColumnMigration: (...args: unknown[]) => mockRunDropCommentaireColumnMigration(...args),
  runSessionStatutI18nMigration: (...args: unknown[]) => mockRunSessionStatutI18nMigration(...args),
  runMakeAgentAssigneNotNullMigration: (...args: unknown[]) => mockRunMakeAgentAssigneNotNullMigration(...args),
  runMakeCommentAgentNotNullMigration: (...args: unknown[]) => mockRunMakeCommentAgentNotNullMigration(...args),
}))

// Mock sql.js — create a factory for mock DB instances
function createMockStmt(rows: Record<string, unknown>[] = []) {
  let idx = -1
  return {
    bind: vi.fn(),
    step: vi.fn(() => {
      idx++
      return idx < rows.length
    }),
    getAsObject: vi.fn(() => rows[idx]),
    free: vi.fn(),
  }
}

function createMockDb(options?: {
  execResult?: { values: unknown[][] }[]
  prepareRows?: Record<string, unknown>[]
  exportData?: Uint8Array
  runFn?: (...args: unknown[]) => void
  throwOnPrepare?: Error
}) {
  const exported = options?.exportData ?? new Uint8Array([1, 2, 3])
  return {
    exec: vi.fn(() => options?.execResult ?? []),
    run: options?.runFn ?? vi.fn(),
    prepare: options?.throwOnPrepare
      ? vi.fn(() => { throw options.throwOnPrepare })
      : vi.fn(() => createMockStmt(options?.prepareRows ?? [])),
    export: vi.fn(() => exported),
    close: vi.fn(),
  }
}

let mockDatabaseConstructor: ReturnType<typeof vi.fn>
const mockInitSqlJs = vi.fn()

vi.mock('sql.js', () => {
  // Default: return an object with Database constructor
  return {
    default: (...args: unknown[]) => mockInitSqlJs(...args),
    __esModule: true,
  }
})

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  getDbBuffer,
  clearDbCacheEntry,
  registerDbPath,
  assertDbPathAllowed,
  registerProjectPath,
  assertProjectPathAllowed,
  getSqlJs,
  writeDb,
  queryLive,
  migrateDb,
  encryptToken,
  decryptToken,
  FORBIDDEN_WRITE_PATTERN,
} from './db'

// ── Helpers ───────────────────────────────────────────────────────────────────

// getSqlJs uses require('sql.js') internally, so we need to set up the mock
// that it returns. We intercept via the module-level singleton.
function setupSqlJsMock(dbFactory?: () => ReturnType<typeof createMockDb>) {
  mockDatabaseConstructor = vi.fn(() => (dbFactory ?? createMockDb)())
  // getSqlJs does `require('sql.js')` which returns initSqlJs function.
  // The result of calling initSqlJs is { Database: constructor }.
  // Since getSqlJs caches the singleton, we need to reset it between tests
  // by manipulating the module's internal state.
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DB cache — getDbBuffer (T228)', () => {
  const dbPath = '/test/project.db'
  const fakeBuffer = Buffer.from('fake-db-content')

  beforeEach(() => {
    vi.clearAllMocks()
    clearDbCacheEntry(dbPath)
    clearDbCacheEntry('/test/db1.db')
    clearDbCacheEntry('/test/db2.db')
    clearDbCacheEntry('/test/db3.db')
    clearDbCacheEntry('/test/db4.db')
    mockStat.mockResolvedValue({ mtimeMs: 1000 })
    mockReadFile.mockResolvedValue(fakeBuffer)
  })

  it('should read file on first call (cache miss)', async () => {
    const buf = await getDbBuffer(dbPath)
    expect(mockStat).toHaveBeenCalledWith(dbPath)
    expect(mockReadFile).toHaveBeenCalledWith(dbPath)
    expect(buf).toEqual(fakeBuffer)
  })

  it('should return cached buffer on second call with same mtime (cache hit)', async () => {
    await getDbBuffer(dbPath)
    expect(mockReadFile).toHaveBeenCalledTimes(1)

    const buf2 = await getDbBuffer(dbPath)
    expect(mockStat).toHaveBeenCalledTimes(2)
    expect(mockReadFile).toHaveBeenCalledTimes(1)
    expect(buf2).toEqual(fakeBuffer)
  })

  it('should re-read file when mtime changes (cache invalidation)', async () => {
    await getDbBuffer(dbPath)
    expect(mockReadFile).toHaveBeenCalledTimes(1)

    mockStat.mockResolvedValue({ mtimeMs: 2000 })
    const newBuffer = Buffer.from('updated-content')
    mockReadFile.mockResolvedValue(newBuffer)

    const buf2 = await getDbBuffer(dbPath)
    expect(mockReadFile).toHaveBeenCalledTimes(2)
    expect(buf2).toEqual(newBuffer)
  })

  it('should evict stale entries after CACHE_TTL_MS (60s)', async () => {
    vi.useFakeTimers()

    await getDbBuffer(dbPath)
    expect(mockReadFile).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(70000)

    await getDbBuffer(dbPath)
    expect(mockReadFile).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('should enforce MAX_CACHE_ENTRIES=3 by evicting oldest', async () => {
    for (let i = 1; i <= 3; i++) {
      mockStat.mockResolvedValue({ mtimeMs: i * 1000 })
      mockReadFile.mockResolvedValue(Buffer.from(`db${i}`))
      await getDbBuffer(`/test/db${i}.db`)
    }
    expect(mockReadFile).toHaveBeenCalledTimes(3)

    mockStat.mockResolvedValue({ mtimeMs: 4000 })
    mockReadFile.mockResolvedValue(Buffer.from('db4'))
    await getDbBuffer('/test/db4.db')
    expect(mockReadFile).toHaveBeenCalledTimes(4)

    mockStat.mockResolvedValue({ mtimeMs: 1000 })
    mockReadFile.mockResolvedValue(Buffer.from('db1'))
    await getDbBuffer('/test/db1.db')
    expect(mockReadFile).toHaveBeenCalledTimes(5)
  })

  it('should handle stat failure gracefully (fallback to readFile)', async () => {
    mockStat.mockRejectedValueOnce(new Error('ENOENT'))
    const buf = await getDbBuffer(dbPath)
    expect(mockReadFile).toHaveBeenCalled()
    expect(buf).toEqual(fakeBuffer)
  })
})

describe('clearDbCacheEntry', () => {
  it('should force cache miss on next getDbBuffer call', async () => {
    const dbPath = '/test/clear-test.db'
    clearDbCacheEntry(dbPath)
    vi.clearAllMocks()
    mockStat.mockResolvedValue({ mtimeMs: 1000 })
    mockReadFile.mockResolvedValue(Buffer.from('content'))

    await getDbBuffer(dbPath)
    expect(mockReadFile).toHaveBeenCalledTimes(1)

    clearDbCacheEntry(dbPath)

    await getDbBuffer(dbPath)
    expect(mockReadFile).toHaveBeenCalledTimes(2)
  })
})

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

// ── getSqlJs ─────────────────────────────────────────────────────────────────

describe('getSqlJs', () => {
  it('should return a sql.js instance', async () => {
    const result = await getSqlJs()
    // getSqlJs caches the singleton — it should have a Database constructor
    expect(result).toBeDefined()
    expect(result.Database).toBeDefined()
  })

  it('should return same instance on multiple calls (singleton)', async () => {
    const first = await getSqlJs()
    const second = await getSqlJs()
    expect(first).toBe(second)
  })
})

// ── writeDb ──────────────────────────────────────────────────────────────────

describe('writeDb (T313)', () => {
  const dbPath = '/test/write-test.db'
  const fakeBuffer = Buffer.from('fake-db')

  beforeEach(() => {
    vi.clearAllMocks()
    clearDbCacheEntry(dbPath)
    mockStat.mockResolvedValue({ mtimeMs: 1000 })
    mockReadFile.mockResolvedValue(fakeBuffer)
  })

  it('should call fn with a db instance and write result to disk', async () => {
    const fn = vi.fn(() => 'result-value')
    const result = await writeDb(dbPath, fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(result).toBe('result-value')
    // Should write tmp file then rename
    expect(mockWriteFile).toHaveBeenCalledWith(
      dbPath + '.tmp',
      expect.any(Buffer)
    )
    expect(mockRename).toHaveBeenCalledWith(dbPath + '.tmp', dbPath)
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

  it('should not rename if fn throws (rollback)', async () => {
    const fn = vi.fn(() => { throw new Error('mutation-failed') })

    await expect(writeDb(dbPath, fn)).rejects.toThrow('mutation-failed')
    expect(mockRename).not.toHaveBeenCalled()
  })
})

// ── queryLive ────────────────────────────────────────────────────────────────

describe('queryLive', () => {
  const dbPath = '/test/query-test.db'

  beforeEach(() => {
    vi.clearAllMocks()
    clearDbCacheEntry(dbPath)
  })

  it('should return rows from a SELECT query', async () => {
    // Build a real SQLite db buffer with data
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

    // First attempt: "not a database" → retry after cache clear
    // Second attempt: same error → throw
    await expect(queryLive(dbPath, 'SELECT 1', []))
      .rejects.toThrow()
  })

  it('should propagate non-retryable errors immediately', async () => {
    // Build a real db but query a nonexistent table
    const sqlJs = await getSqlJs()
    const db = new sqlJs.Database()
    const buf = Buffer.from(db.export())
    db.close()

    mockStat.mockResolvedValue({ mtimeMs: Date.now() })
    mockReadFile.mockResolvedValue(buf)

    await expect(queryLive(dbPath, 'SELECT * FROM nonexistent_table', []))
      .rejects.toThrow(/no such table/)
  })
})

// ── migrateDb ────────────────────────────────────────────────────────────────

describe('migrateDb', () => {
  const dbPath = '/test/migrate-test.db'

  beforeEach(() => {
    vi.clearAllMocks()
    clearDbCacheEntry(dbPath)
    // Reset all migration mocks
    mockRunTaskStatusMigration.mockReturnValue(0)
    mockRunAddPriorityMigration.mockReturnValue(false)
    mockRunTaskStatutI18nMigration.mockReturnValue(0)
    mockRunAddConvIdToSessionsMigration.mockReturnValue(false)
    mockRunAddTokensToSessionsMigration.mockReturnValue(0)
    mockRunRemoveThinkingModeBudgetTokensMigration.mockReturnValue(false)
    mockRunDropCommentaireColumnMigration.mockReturnValue(0)
    mockRunSessionStatutI18nMigration.mockReturnValue(0)
    mockRunMakeAgentAssigneNotNullMigration.mockReturnValue(false)
    mockRunMakeCommentAgentNotNullMigration.mockReturnValue(false)
  })

  /** Build a minimal SQLite DB buffer with all tables migrateDb expects */
  async function buildTestDbBuffer() {
    const sqlJs = await getSqlJs()
    const db = new sqlJs.Database()
    db.run(`CREATE TABLE agents (
      id INTEGER PRIMARY KEY, name TEXT, type TEXT, perimetre TEXT,
      system_prompt TEXT, system_prompt_suffix TEXT, thinking_mode TEXT, allowed_tools TEXT, created_at TEXT
    )`)
    db.run(`CREATE TABLE tasks (
      id INTEGER PRIMARY KEY, titre TEXT, description TEXT, statut TEXT,
      agent_createur_id INTEGER, agent_assigne_id INTEGER, agent_valideur_id INTEGER,
      parent_task_id INTEGER, session_id INTEGER, perimetre TEXT, effort INTEGER,
      priority TEXT, created_at TEXT, updated_at TEXT, started_at TEXT, completed_at TEXT, validated_at TEXT
    )`)
    db.run(`CREATE TABLE sessions (
      id INTEGER PRIMARY KEY, agent_id INTEGER, started_at TEXT, ended_at TEXT,
      updated_at TEXT, statut TEXT, summary TEXT, claude_conv_id TEXT
    )`)
    db.run(`CREATE TABLE task_comments (
      id INTEGER PRIMARY KEY, task_id INTEGER, agent_id INTEGER, contenu TEXT, created_at TEXT
    )`)
    db.run(`CREATE TABLE task_links (
      id INTEGER PRIMARY KEY, from_task INTEGER, to_task INTEGER, type TEXT, created_at TEXT
    )`)
    db.run(`CREATE TABLE locks (
      id INTEGER PRIMARY KEY, fichier TEXT, agent_id INTEGER, session_id INTEGER, created_at TEXT, released_at TEXT
    )`)
    db.run(`CREATE TABLE agent_logs (
      id INTEGER PRIMARY KEY, session_id INTEGER, agent_id INTEGER, niveau TEXT,
      action TEXT, detail TEXT, fichiers TEXT, created_at TEXT
    )`)
    db.run(`CREATE TABLE config (
      key TEXT PRIMARY KEY, value TEXT, updated_at TEXT
    )`)
    db.run(`CREATE TABLE perimetres (
      id INTEGER PRIMARY KEY, name TEXT UNIQUE, dossier TEXT, techno TEXT, description TEXT, actif INTEGER DEFAULT 1, created_at TEXT
    )`)
    const buf = Buffer.from(db.export())
    db.close()
    return buf
  }

  it('should create backup before migration', async () => {
    mockReadFile.mockResolvedValue(await buildTestDbBuffer())
    mockCopyFile.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockUnlink.mockResolvedValue(undefined)

    await migrateDb(dbPath)

    expect(mockCopyFile).toHaveBeenCalledWith(dbPath, `${dbPath}.bak`)
  })

  it('should call all migration functions', async () => {
    mockReadFile.mockResolvedValue(await buildTestDbBuffer())

    await migrateDb(dbPath)

    expect(mockRunDropCommentaireColumnMigration).toHaveBeenCalled()
    expect(mockRunAddConvIdToSessionsMigration).toHaveBeenCalled()
    expect(mockRunAddTokensToSessionsMigration).toHaveBeenCalled()
    expect(mockRunAddPriorityMigration).toHaveBeenCalled()
    expect(mockRunTaskStatutI18nMigration).toHaveBeenCalled()
    expect(mockRunRemoveThinkingModeBudgetTokensMigration).toHaveBeenCalled()
    expect(mockRunTaskStatusMigration).toHaveBeenCalled()
    expect(mockRunMakeAgentAssigneNotNullMigration).toHaveBeenCalled()
    expect(mockRunMakeCommentAgentNotNullMigration).toHaveBeenCalled()
    expect(mockRunSessionStatutI18nMigration).toHaveBeenCalled()
  })

  it('should delete backup on success', async () => {
    mockReadFile.mockResolvedValue(await buildTestDbBuffer())

    await migrateDb(dbPath)

    expect(mockUnlink).toHaveBeenCalledWith(`${dbPath}.bak`)
  })

  it('should keep backup on failure', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('corrupted'))

    await expect(migrateDb(dbPath)).rejects.toThrow()
    expect(mockUnlink).not.toHaveBeenCalled()
  })

  it('should return migrated count', async () => {
    mockReadFile.mockResolvedValue(await buildTestDbBuffer())
    mockRunTaskStatutI18nMigration.mockReturnValue(5)
    mockRunTaskStatusMigration.mockReturnValue(3)
    mockRunSessionStatutI18nMigration.mockReturnValue(2)

    const result = await migrateDb(dbPath)
    expect(result).toEqual({ migrated: 10 })
  })
})

// ── encryptToken / decryptToken ──────────────────────────────────────────────

describe('encryptToken / decryptToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEncryptionAvailable.mockReturnValue(false)
  })

  it('should roundtrip when encryption is available', () => {
    mockIsEncryptionAvailable.mockReturnValue(true)
    const encrypted = Buffer.from('encrypted-data')
    mockEncryptString.mockReturnValue(encrypted)
    mockDecryptString.mockReturnValue('my-secret-token')

    const cipher = encryptToken('my-secret-token')
    expect(cipher).toBe(encrypted.toString('base64'))

    const plain = decryptToken(cipher)
    expect(plain).toBe('my-secret-token')
  })

  it('should passthrough when encryption is unavailable', () => {
    mockIsEncryptionAvailable.mockReturnValue(false)

    const cipher = encryptToken('plain-token')
    expect(cipher).toBe('plain-token')

    const plain = decryptToken('plain-token')
    expect(plain).toBe('plain-token')
  })

  it('should return empty string for empty input', () => {
    expect(encryptToken('')).toBe('')
    expect(decryptToken('')).toBe('')
  })

  it('should passthrough on encryption failure', () => {
    mockIsEncryptionAvailable.mockReturnValue(true)
    mockEncryptString.mockImplementation(() => { throw new Error('crypto-fail') })

    const result = encryptToken('my-token')
    expect(result).toBe('my-token')
  })

  it('should passthrough on decryption failure (e.g. invalid base64)', () => {
    mockIsEncryptionAvailable.mockReturnValue(true)
    mockDecryptString.mockImplementation(() => { throw new Error('bad-decrypt') })

    const result = decryptToken('not-valid-base64!!!')
    expect(result).toBe('not-valid-base64!!!')
  })
})

// ── FORBIDDEN_WRITE_PATTERN ──────────────────────────────────────────────────

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
