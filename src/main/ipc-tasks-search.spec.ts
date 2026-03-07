/**
 * Integration tests — IPC task handlers — T985
 *
 * Covers:
 * - search-tasks
 * - update-perimetre
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Shared in-memory buffer ───────────────────────────────────────────────────
let dbBuffer: Buffer = Buffer.alloc(0)
let dbMtime = 1000

// ── Mock fs/promises ──────────────────────────────────────────────────────────
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
    readFile: vi.fn(async () => dbBuffer),
    writeFile: vi.fn(async (_path: string, data: Buffer) => { dbBuffer = data; dbMtime += 1 }),
    rename: vi.fn(async () => undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
  stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
  readFile: vi.fn(async () => dbBuffer),
  writeFile: vi.fn(async (_path: string, data: Buffer) => { dbBuffer = data; dbMtime += 1 }),
  rename: vi.fn(async () => undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  mkdir: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock fs (sync) ────────────────────────────────────────────────────────────
vi.mock('fs', () => {
  const watch = vi.fn(() => ({ close: vi.fn() }))
  const existsSync = vi.fn(() => false)
  const readdirSync = vi.fn(() => [] as string[])
  const createReadStream = vi.fn(() => ({ on: vi.fn(), destroy: vi.fn() }))
  return {
    default: { watch, existsSync, readdirSync, createReadStream },
    watch, existsSync, readdirSync, createReadStream,
  }
})

// ── Mock readline ─────────────────────────────────────────────────────────────
vi.mock('readline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('readline')>()
  const { EventEmitter } = await import('events')
  const createInterface = vi.fn(({ input }: { input: NodeJS.ReadableStream }) => {
    input.on('error', () => {})
    if ('destroy' in input && typeof input.destroy === 'function') input.destroy()
    const rl = new EventEmitter() as NodeJS.EventEmitter & { close: () => void }
    rl.close = () => {}
    setImmediate(() => { rl.emit('error', new Error('ENOENT: no such file')) })
    return rl
  })
  return { ...actual, createInterface, default: { ...actual, createInterface } }
})

// ── Mock electron ─────────────────────────────────────────────────────────────
const handlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  app: { getVersion: vi.fn(() => '0.5.0'), isPackaged: false, getAppPath: vi.fn(() => '/app') },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined), showItemInFolder: vi.fn() },
}))

vi.mock('./claude-md', () => ({ insertAgentIntoClaudeMd: vi.fn((c: string) => c) }))

vi.mock('child_process', () => ({
  default: { execSync: vi.fn(), execFile: vi.fn(), spawn: vi.fn(() => ({ unref: vi.fn() })) },
  execSync: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import { registerDbPath, registerProjectPath, clearDbCacheEntry, queryLive, writeDb } from './db'
import { registerIpcHandlers } from './ipc'
import {
  buildSchema,
  insertAgent,
  insertTask,
  TEST_DB_PATH,
  TEST_PROJECT_PATH,
} from './test-utils/ipc-test-setup'

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(async () => {
  vi.clearAllMocks()
  clearDbCacheEntry(TEST_DB_PATH)
  dbMtime = 1000

  const db = await buildSchema()
  dbBuffer = Buffer.from(db.export())
  db.close()

  registerDbPath(TEST_DB_PATH)
  registerProjectPath(TEST_PROJECT_PATH)
  registerIpcHandlers()
})

afterEach(() => {
  clearDbCacheEntry(TEST_DB_PATH)
})

// ── Tests: search-tasks ───────────────────────────────────────────────────────

describe('search-tasks (T985)', () => {
  it('returns all tasks when query is empty', async () => {
    await insertTask('task-search-1')
    await insertTask('task-search-2')

    const result = await handlers['search-tasks'](null, TEST_DB_PATH, '') as { success: boolean; results: unknown[] }

    expect(result.success).toBe(true)
    expect(result.results).toHaveLength(2)
  })

  it('matches tasks by title (LIKE fallback)', async () => {
    await insertTask('alpha task')
    await insertTask('beta task')

    const result = await handlers['search-tasks'](
      null, TEST_DB_PATH, 'alpha'
    ) as { success: boolean; results: Array<{ title: string }> }

    expect(result.success).toBe(true)
    expect(result.results).toHaveLength(1)
    expect(result.results[0].title).toBe('alpha task')
  })

  it('matches tasks by description (LIKE fallback)', async () => {
    await insertTask('task-desc-search', { description: 'unique-keyword-xyz' })
    await insertTask('other-task', { description: 'nothing special' })

    const result = await handlers['search-tasks'](
      null, TEST_DB_PATH, 'unique-keyword-xyz'
    ) as { success: boolean; results: Array<{ title: string }> }

    expect(result.success).toBe(true)
    expect(result.results.map(r => r.title)).toContain('task-desc-search')
  })

  it('filters by status when provided', async () => {
    await insertTask('task-todo', { status: 'todo' })
    await insertTask('task-done', { status: 'done' })

    const result = await handlers['search-tasks'](
      null, TEST_DB_PATH, '', { status: 'todo' }
    ) as { success: boolean; results: Array<{ status: string }> }

    expect(result.success).toBe(true)
    expect(result.results.every(r => r.status === 'todo')).toBe(true)
  })

  it('filters by scope when provided', async () => {
    await insertTask('task-front', { scope: 'front-vuejs' })
    await insertTask('task-back', { scope: 'back-electron' })

    const result = await handlers['search-tasks'](
      null, TEST_DB_PATH, '', { scope: 'front-vuejs' }
    ) as { success: boolean; results: Array<{ scope: string }> }

    expect(result.success).toBe(true)
    expect(result.results.every(r => r.scope === 'front-vuejs')).toBe(true)
  })

  it('returns { success: false, results: [] } for unregistered dbPath', async () => {
    const result = await handlers['search-tasks'](
      null, '/evil/db.db', 'query'
    ) as { success: boolean; results: unknown[] }

    expect(result.success).toBe(false)
    expect(result.results).toEqual([])
  })
})

// ── Tests: update-perimetre ───────────────────────────────────────────────────

describe('update-perimetre (T985)', () => {
  it('updates perimeter name and description', async () => {
    let scopeId!: number
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO scopes (name, description) VALUES ('front-old', 'Old desc')")
      const rows = db.exec('SELECT last_insert_rowid() as id')
      scopeId = rows[0].values[0][0] as number
    })

    const result = await handlers['update-perimetre'](
      null, TEST_DB_PATH, scopeId, 'front-old', 'front-new', 'New desc'
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT name, description FROM scopes WHERE id = ?',
      [scopeId]
    ) as Array<{ name: string; description: string }>
    expect(rows[0].name).toBe('front-new')
    expect(rows[0].description).toBe('New desc')
  })

  it('cascades rename to tasks.scope', async () => {
    let scopeId!: number
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO scopes (name) VALUES ('cascade-peri')")
      const rows = db.exec('SELECT last_insert_rowid() as id')
      scopeId = rows[0].values[0][0] as number
    })
    await insertTask('task-in-peri', { scope: 'cascade-peri' })

    await handlers['update-perimetre'](
      null, TEST_DB_PATH, scopeId, 'cascade-peri', 'cascade-peri-new', ''
    )

    const taskRows = await queryLive(
      TEST_DB_PATH,
      "SELECT scope FROM tasks WHERE title = 'task-in-peri'",
      []
    ) as Array<{ scope: string }>
    expect(taskRows[0].scope).toBe('cascade-peri-new')
  })

  it('cascades rename to agents.scope', async () => {
    let scopeId!: number
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO scopes (name) VALUES ('agent-peri')")
      const rows = db.exec('SELECT last_insert_rowid() as id')
      scopeId = rows[0].values[0][0] as number
    })
    await insertAgent('agent-in-peri', { scope: 'agent-peri' })

    await handlers['update-perimetre'](
      null, TEST_DB_PATH, scopeId, 'agent-peri', 'agent-peri-new', ''
    )

    const agentRows = await queryLive(
      TEST_DB_PATH,
      "SELECT scope FROM agents WHERE name = 'agent-in-peri'",
      []
    ) as Array<{ scope: string }>
    expect(agentRows[0].scope).toBe('agent-peri-new')
  })

  it('does not cascade when name unchanged', async () => {
    let scopeId!: number
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run("INSERT INTO scopes (name) VALUES ('no-change')")
      const rows = db.exec('SELECT last_insert_rowid() as id')
      scopeId = rows[0].values[0][0] as number
    })
    await insertTask('task-no-cascade', { scope: 'no-change' })

    await handlers['update-perimetre'](
      null, TEST_DB_PATH, scopeId, 'no-change', 'no-change', 'Updated desc'
    )

    const taskRows = await queryLive(
      TEST_DB_PATH,
      "SELECT scope FROM tasks WHERE title = 'task-no-cascade'",
      []
    ) as Array<{ scope: string }>
    expect(taskRows[0].scope).toBe('no-change')
  })

  it('returns { success: false } for unregistered dbPath', async () => {
    const result = await handlers['update-perimetre'](
      null, '/evil/db.db', 1, 'old', 'new', 'desc'
    ) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})
