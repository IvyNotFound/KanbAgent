/**
 * Integration tests — IPC agent CRUD handlers — T985
 *
 * Covers:
 * - create-agent
 * - rename-agent
 * - update-agent-system-prompt
 * - update-agent-thinking-mode
 * - build-agent-prompt
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
vi.mock('readline', async () => {
  const { EventEmitter } = await import('events')
  const createInterface = vi.fn(({ input }: { input: NodeJS.ReadableStream }) => {
    input.on('error', () => {})
    if ('destroy' in input && typeof input.destroy === 'function') input.destroy()
    const rl = new EventEmitter() as NodeJS.EventEmitter & { close: () => void }
    rl.close = () => {}
    setImmediate(() => { rl.emit('error', new Error('ENOENT: no such file')) })
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
  app: { getVersion: vi.fn(() => '0.5.0'), isPackaged: false, getAppPath: vi.fn(() => '/app') },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined), showItemInFolder: vi.fn() },
}))

vi.mock('./claude-md', () => ({ insertAgentIntoClaudeMd: vi.fn((c: string) => c) }))

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

  await buildSchema()

  registerDbPath(TEST_DB_PATH)
  registerProjectPath(TEST_PROJECT_PATH)
  registerIpcHandlers()
})

afterEach(() => {
  clearDbCacheEntry(TEST_DB_PATH)
})

// ── Tests: create-agent ───────────────────────────────────────────────────────

describe('create-agent (T985)', () => {
  it('creates an agent and returns { success: true, agentId }', async () => {
    const result = await handlers['create-agent'](
      null,
      TEST_DB_PATH,
      TEST_PROJECT_PATH,
      { name: 'new-agent', type: 'dev', scope: 'front-vuejs', thinkingMode: null, systemPrompt: null, description: 'Test agent' }
    ) as { success: boolean; agentId: number; claudeMdUpdated: boolean }

    expect(result.success).toBe(true)
    expect(typeof result.agentId).toBe('number')

    const rows = await queryLive(
      TEST_DB_PATH, 'SELECT name, type FROM agents WHERE id = ?', [result.agentId]
    ) as Array<{ name: string; type: string }>
    expect(rows[0].name).toBe('new-agent')
    expect(rows[0].type).toBe('dev')
  })

  it('returns { success: false, error } for duplicate agent name', async () => {
    await insertAgent('duplicate-agent')

    const result = await handlers['create-agent'](
      null,
      TEST_DB_PATH,
      TEST_PROJECT_PATH,
      { name: 'duplicate-agent', type: 'test', scope: null, thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('duplicate-agent')
  })

  it('returns { success: false, error: DB_PATH_NOT_ALLOWED } for unregistered dbPath', async () => {
    const result = await handlers['create-agent'](
      null,
      '/evil/db.db',
      TEST_PROJECT_PATH,
      { name: 'evil-agent', type: 'test', scope: null, thinkingMode: null, systemPrompt: null, description: '' }
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── Tests: rename-agent ───────────────────────────────────────────────────────

describe('rename-agent (T985)', () => {
  it('renames an agent in the DB', async () => {
    const agentId = await insertAgent('agent-rename-me')

    const result = await handlers['rename-agent'](
      null, TEST_DB_PATH, agentId, 'agent-renamed'
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH, 'SELECT name FROM agents WHERE id = ?', [agentId]
    ) as Array<{ name: string }>
    expect(rows[0].name).toBe('agent-renamed')
  })

  it('returns { success: false, error } for unregistered dbPath', async () => {
    const result = await handlers['rename-agent'](
      null, '/evil/db.db', 1, 'new-name'
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('returns { success: true } even for non-existent agentId (UPDATE no-op)', async () => {
    const result = await handlers['rename-agent'](
      null, TEST_DB_PATH, 99999, 'ghost'
    ) as { success: boolean }

    expect(result.success).toBe(true)
  })
})

// ── Tests: update-agent-system-prompt ────────────────────────────────────────

describe('update-agent-system-prompt (T985)', () => {
  it('updates system_prompt for an agent', async () => {
    const agentId = await insertAgent('agent-sp')

    const result = await handlers['update-agent-system-prompt'](
      null, TEST_DB_PATH, agentId, 'You are a helpful agent.'
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH, 'SELECT system_prompt FROM agents WHERE id = ?', [agentId]
    ) as Array<{ system_prompt: string }>
    expect(rows[0].system_prompt).toBe('You are a helpful agent.')
  })

  it('stores NULL when empty string is passed', async () => {
    const agentId = await insertAgent('agent-sp-null')
    await handlers['update-agent-system-prompt'](null, TEST_DB_PATH, agentId, 'Initial prompt')
    await handlers['update-agent-system-prompt'](null, TEST_DB_PATH, agentId, '')

    const rows = await queryLive(
      TEST_DB_PATH, 'SELECT system_prompt FROM agents WHERE id = ?', [agentId]
    ) as Array<{ system_prompt: null }>
    expect(rows[0].system_prompt).toBeNull()
  })

  it('returns { success: false, error } for unregistered dbPath', async () => {
    const result = await handlers['update-agent-system-prompt'](
      null, '/evil/db.db', 1, 'prompt'
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── Tests: update-agent-thinking-mode ────────────────────────────────────────

describe('update-agent-thinking-mode (T985)', () => {
  it('sets thinking_mode to "auto" → persisted in DB', async () => {
    const agentId = await insertAgent('agent-think-auto')

    const result = await handlers['update-agent-thinking-mode'](
      null, TEST_DB_PATH, agentId, 'auto'
    ) as { success: boolean }

    expect(result.success).toBe(true)
    const rows = await queryLive(
      TEST_DB_PATH, 'SELECT thinking_mode FROM agents WHERE id = ?', [agentId]
    ) as Array<{ thinking_mode: string }>
    expect(rows[0].thinking_mode).toBe('auto')
  })

  it('sets thinking_mode to "disabled" → persisted in DB', async () => {
    const agentId = await insertAgent('agent-think-disabled')

    await handlers['update-agent-thinking-mode'](null, TEST_DB_PATH, agentId, 'disabled')

    const rows = await queryLive(
      TEST_DB_PATH, 'SELECT thinking_mode FROM agents WHERE id = ?', [agentId]
    ) as Array<{ thinking_mode: string }>
    expect(rows[0].thinking_mode).toBe('disabled')
  })

  it('returns { success: false, error } for invalid value', async () => {
    const agentId = await insertAgent('agent-think-invalid')

    const result = await handlers['update-agent-thinking-mode'](
      null, TEST_DB_PATH, agentId, 'always'
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('always')
  })

  it('accepts null → stored as NULL in DB', async () => {
    const agentId = await insertAgent('agent-think-null')
    await handlers['update-agent-thinking-mode'](null, TEST_DB_PATH, agentId, 'auto')
    await handlers['update-agent-thinking-mode'](null, TEST_DB_PATH, agentId, null)

    const rows = await queryLive(
      TEST_DB_PATH, 'SELECT thinking_mode FROM agents WHERE id = ?', [agentId]
    ) as Array<{ thinking_mode: null }>
    expect(rows[0].thinking_mode).toBeNull()
  })

  it('returns { success: false, error } for unregistered dbPath', async () => {
    const result = await handlers['update-agent-thinking-mode'](
      null, '/evil/db.db', 1, 'auto'
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── Tests: build-agent-prompt ─────────────────────────────────────────────────
