/**
 * IPC agent handler tests — File 3 of 6
 * Covers: add-perimetre (T438), update-agent permissionMode (T436),
 *         get-agent-system-prompt permissionMode (T436)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Shared in-memory buffer ───────────────────────────────────────────────────
let dbBuffer: Buffer = Buffer.alloc(0)
let dbMtime = 1000

// ── Mock fs/promises ─────────────────────────────────────────────────────────
let jsonlMockContent: string | Error | null = null

const { readFileMockImpl } = vi.hoisted(() => ({
  readFileMockImpl: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
    readFile: readFileMockImpl,
    writeFile: vi.fn(async (_path: string, data: Buffer) => {
      dbBuffer = data
      dbMtime += 1
    }),
    rename: vi.fn(async (src: string) => { void src }),
    copyFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
  stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
  readFile: readFileMockImpl,
  writeFile: vi.fn(async (_path: string, data: Buffer) => {
    dbBuffer = data
    dbMtime += 1
  }),
  rename: vi.fn(async () => undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock readline ─────────────────────────────────────────────────────────────
vi.mock('readline', async () => {
  const { EventEmitter } = await import('events')
  const createInterface = vi.fn(({ input }: { input: NodeJS.ReadableStream }) => {
    input.on('error', () => {})
    if ('destroy' in input && typeof input.destroy === 'function') input.destroy()
    const rl = new EventEmitter() as NodeJS.EventEmitter & { close: () => void }
    rl.close = () => {}
    setImmediate(() => {
      if (jsonlMockContent instanceof Error) { rl.emit('error', jsonlMockContent); return }
      if (jsonlMockContent === null) { rl.emit('error', new Error('ENOENT: no such file')); return }
      for (const line of jsonlMockContent.split('\n')) { rl.emit('line', line) }
      rl.emit('close')
    })
    return rl
  })
  return { createInterface, default: { createInterface } }
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
  app: { getVersion: vi.fn(() => '0.5.0') },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
}))

// ── Mock migration ────────────────────────────────────────────────────────────
vi.mock('./migration', () => ({
  runTaskStatusMigration: vi.fn(() => 0),
  runAddPriorityMigration: vi.fn(() => false),
  runTaskStatutI18nMigration: vi.fn(() => 0),
  runAddConvIdToSessionsMigration: vi.fn(() => false),
  runAddTokensToSessionsMigration: vi.fn(() => 0),
  runRemoveThinkingModeBudgetTokensMigration: vi.fn(() => false),
  runDropCommentaireColumnMigration: vi.fn(() => 0),
  runSessionStatutI18nMigration: vi.fn(() => 0),
  runMakeAgentAssigneNotNullMigration: vi.fn(() => false),
  runMakeCommentAgentNotNullMigration: vi.fn(() => false),
}))

vi.mock('./claude-md', () => ({
  insertAgentIntoClaudeMd: vi.fn((content: string) => content),
}))

vi.mock('./db-lock', () => ({
  acquireWriteLock: vi.fn().mockResolvedValue('/mock.wlock'),
  releaseWriteLock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('better-sqlite3', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    default: function MockDatabase() { return new (mod as any).default(':memory:') },
  }
})

// ── Import after mocks ────────────────────────────────────────────────────────
import { registerDbPath, clearDbCacheEntry, queryLive, writeDb } from './db'
import { registerAgentHandlers } from './ipc-agents'
import {
  buildSchema,
  TEST_DB_PATH,
  insertAgent,
} from './ipc-agents-test-setup'

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(async () => {
  vi.clearAllMocks()
  jsonlMockContent = null
  clearDbCacheEntry(TEST_DB_PATH)
  dbMtime = 1000

  readFileMockImpl.mockImplementation(async (path: string) => {
    if (typeof path === 'string' && path.endsWith('.jsonl')) {
      if (jsonlMockContent instanceof Error) throw jsonlMockContent
      if (jsonlMockContent !== null) return jsonlMockContent
      throw new Error('ENOENT: no such file')
    }
    return dbBuffer
  })

  registerDbPath(TEST_DB_PATH)
  await buildSchema()
  registerAgentHandlers()
})

afterEach(() => {
  clearDbCacheEntry(TEST_DB_PATH)
})

// ── Tests: add-perimetre (T438) ───────────────────────────────────────────────

describe('add-perimetre — T438', () => {
  it('valid name → inserted and returns id', async () => {
    const result = await handlers['add-perimetre'](
      null,
      TEST_DB_PATH,
      'front-vuejs'
    ) as { success: boolean; id: number }

    expect(result.success).toBe(true)
    expect(typeof result.id).toBe('number')
    expect(result.id).toBeGreaterThan(0)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT name FROM scopes WHERE id = ?',
      [result.id]
    ) as Array<{ name: string }>
    expect(rows[0]?.name).toBe('front-vuejs')
  })

  it('trims whitespace from name', async () => {
    const result = await handlers['add-perimetre'](
      null,
      TEST_DB_PATH,
      '  back-electron  '
    ) as { success: boolean; id: number }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT name FROM scopes WHERE id = ?',
      [result.id]
    ) as Array<{ name: string }>
    expect(rows[0]?.name).toBe('back-electron')
  })

  it('duplicate name → {success:false, error}', async () => {
    await handlers['add-perimetre'](null, TEST_DB_PATH, 'unique-scope')

    const result = await handlers['add-perimetre'](
      null,
      TEST_DB_PATH,
      'unique-scope'
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('unique-scope')
  })

  it('empty name → {success:false, error}', async () => {
    const result = await handlers['add-perimetre'](
      null,
      TEST_DB_PATH,
      '   '
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid perimeter name')
  })

  it('missing name → {success:false, error}', async () => {
    const result = await handlers['add-perimetre'](
      null,
      TEST_DB_PATH,
      ''
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid perimeter name')
  })
})

// ── Tests: update-agent permissionMode (T436) ─────────────────────────────────

describe('update-agent — permissionMode (T436)', () => {
  it('set permissionMode=auto → DB reflects auto', async () => {
    const agentId = await insertAgent('agent-perm-auto')

    const result = await handlers['update-agent'](
      null,
      TEST_DB_PATH,
      agentId,
      { permissionMode: 'auto' }
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT permission_mode FROM agents WHERE id = ?',
      [agentId]
    ) as Array<{ permission_mode: string | null }>

    expect(rows[0].permission_mode).toBe('auto')
  })

  it('set permissionMode=default → DB reflects default', async () => {
    const agentId = await insertAgent('agent-perm-default')

    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { permissionMode: 'auto' })

    const result = await handlers['update-agent'](
      null,
      TEST_DB_PATH,
      agentId,
      { permissionMode: 'default' }
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT permission_mode FROM agents WHERE id = ?',
      [agentId]
    ) as Array<{ permission_mode: string | null }>

    expect(rows[0].permission_mode).toBe('default')
  })

  it('permissionMode not provided → existing value unchanged', async () => {
    const agentId = await insertAgent('agent-perm-unchanged')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('UPDATE agents SET permission_mode = ? WHERE id = ?', ['auto', agentId])
    })

    await handlers['update-agent'](null, TEST_DB_PATH, agentId, { name: 'agent-perm-unchanged' })

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT permission_mode FROM agents WHERE id = ?',
      [agentId]
    ) as Array<{ permission_mode: string | null }>

    expect(rows[0].permission_mode).toBe('auto')
  })
})

// ── Tests: get-agent-system-prompt returns permissionMode (T436) ──────────────

describe('get-agent-system-prompt — permissionMode (T436)', () => {
  it('returns permissionMode=auto when set', async () => {
    const agentId = await insertAgent('agent-gsp-auto')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('UPDATE agents SET permission_mode = ? WHERE id = ?', ['auto', agentId])
    })

    const result = await handlers['get-agent-system-prompt'](
      null,
      TEST_DB_PATH,
      agentId
    ) as { success: boolean; permissionMode: string | null }

    expect(result.success).toBe(true)
    expect(result.permissionMode).toBe('auto')
  })

  it('returns permissionMode=default when not set to auto', async () => {
    const agentId = await insertAgent('agent-gsp-default')

    const result = await handlers['get-agent-system-prompt'](
      null,
      TEST_DB_PATH,
      agentId
    ) as { success: boolean; permissionMode: string | null }

    expect(result.success).toBe(true)
    expect(['default', null]).toContain(result.permissionMode)
  })

  it('returns permissionMode=null for agent not found', async () => {
    const result = await handlers['get-agent-system-prompt'](
      null,
      TEST_DB_PATH,
      99999
    ) as { success: boolean; permissionMode: string | null }

    expect(result.success).toBe(false)
    expect(result.permissionMode).toBeNull()
  })
})
