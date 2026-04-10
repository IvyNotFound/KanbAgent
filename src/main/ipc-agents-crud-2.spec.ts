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

describe('build-agent-prompt (T985)', () => {
  it('returns userPrompt as-is when dbPath/agentId are not provided', async () => {
    const result = await handlers['build-agent-prompt'](
      null, 'agent-name', 'T123 task prompt'
    ) as string

    expect(result).toBe('T123 task prompt')
  })

  it('returns userPrompt as-is when dbPath is not registered', async () => {
    const result = await handlers['build-agent-prompt'](
      null, 'agent-name', 'prompt text', '/unregistered/db.db', 1
    ) as string

    expect(result).toBe('prompt text')
  })

  it('creates a session and includes context block for valid agent', async () => {
    const agentId = await insertAgent('context-agent', { type: 'test', scope: 'back-electron' })
    await insertTask('open-task', { status: 'todo', agentId })

    const result = await handlers['build-agent-prompt'](
      null, 'context-agent', 'T999', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('=== IDENTIFIANTS ===')
    expect(result).toContain('context-agent')
    expect(result).toContain('=== TÂCHES ASSIGNÉES ===')
    expect(result).toContain('open-task')
    expect(result).toContain('T999')
  })

  it('creates a new session row in DB', async () => {
    const agentId = await insertAgent('session-creator')
    const sessionsBefore = await queryLive(
      TEST_DB_PATH, 'SELECT COUNT(*) as cnt FROM sessions', []
    ) as Array<{ cnt: number }>

    await handlers['build-agent-prompt'](
      null, 'session-creator', 'my prompt', TEST_DB_PATH, agentId
    )

    const sessionsAfter = await queryLive(
      TEST_DB_PATH, 'SELECT COUNT(*) as cnt FROM sessions', []
    ) as Array<{ cnt: number }>
    expect(sessionsAfter[0].cnt).toBe(sessionsBefore[0].cnt + 1)
  })

  it('includes previous session summary when available', async () => {
    const agentId = await insertAgent('agent-with-history')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run(
        "INSERT INTO sessions (agent_id, status, summary) VALUES (?, 'completed', ?)",
        [agentId, 'Done:T123. Pending:none. Next:backlog']
      )
    })

    const result = await handlers['build-agent-prompt'](
      null, 'agent-with-history', '', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('Done:T123')
  })

  it('shows active locks in context block', async () => {
    const agentId = await insertAgent('agent-locked')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run('INSERT INTO locks (file, agent_id) VALUES (?, ?)', ['src/main/ipc.ts', agentId])
    })

    const result = await handlers['build-agent-prompt'](
      null, 'agent-locked', '', TEST_DB_PATH, agentId
    ) as string

    expect(result).toContain('src/main/ipc.ts')
  })
})
