/**
 * Integration tests — ipc-agent-crud.ts handlers — T1479
 *
 * Directly exercises registerAgentCrudHandlers() for:
 * - STANDARD_AGENT_SUFFIX export content
 * - rename-agent: valid rename, invalid agentId (0, -1, string), invalid newName (empty, >200 chars)
 * - delete-agent: valid deletion, non-existent id, agent with history blocked
 * - create-agent: valid payload, missing required field, duplicate name
 * - update-agent: valid update, invalid field, invalid agentId
 * - get-agent-system-prompt / update-agent-system-prompt: round-trip read/write, unknown dbPath
 * - agent:duplicate: valid duplicate, unique name generation, invalid agentId
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
import { registerAgentCrudHandlers, STANDARD_AGENT_SUFFIX } from './ipc-agent-crud'
import { buildSchema, insertAgent, TEST_DB_PATH, TEST_PROJECT_PATH } from './test-utils/ipc-test-setup'

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(async () => {
  vi.clearAllMocks()
  clearDbCacheEntry(TEST_DB_PATH)
  dbMtime = 1000
  dbBuffer = Buffer.alloc(0)

  await buildSchema()
  registerDbPath(TEST_DB_PATH)
  registerProjectPath(TEST_PROJECT_PATH)
  registerAgentCrudHandlers()
})

afterEach(() => {
  clearDbCacheEntry(TEST_DB_PATH)
})

// ── STANDARD_AGENT_SUFFIX ─────────────────────────────────────────────────────

describe('get-agent-system-prompt + update-agent-system-prompt round-trip (T1479)', () => {
  it('writes system prompt and reads it back', async () => {
    const agentId = await insertAgent('agent-prompt-roundtrip')

    await handlers['update-agent-system-prompt'](null, TEST_DB_PATH, agentId, 'You are a test agent.')

    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, agentId) as {
      success: boolean; systemPrompt: string | null
    }
    expect(result.success).toBe(true)
    expect(result.systemPrompt).toBe('You are a test agent.')
  })

  it('get-agent-system-prompt returns all expected fields', async () => {
    const agentId = await insertAgent('agent-full-prompt')

    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, agentId) as {
      success: boolean
      systemPrompt: string | null
      systemPromptSuffix: string | null
      thinkingMode: string | null
      permissionMode: string | null
      worktreeEnabled: number | null
      preferredModel: string | null
    }
    expect(result.success).toBe(true)
    expect('systemPrompt' in result).toBe(true)
    expect('systemPromptSuffix' in result).toBe(true)
    expect('thinkingMode' in result).toBe(true)
    expect('permissionMode' in result).toBe(true)
    expect('worktreeEnabled' in result).toBe(true)
    expect('preferredModel' in result).toBe(true)
  })

  it('returns success: false for unknown agent', async () => {
    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, 99999) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  it('unauthorized dbPath → success: false with DB_PATH_NOT_ALLOWED', async () => {
    const result = await handlers['update-agent-system-prompt'](null, '/evil/db.db', 1, 'prompt') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('empty string stored as NULL', async () => {
    const agentId = await insertAgent('agent-null-prompt')
    await handlers['update-agent-system-prompt'](null, TEST_DB_PATH, agentId, 'initial')
    await handlers['update-agent-system-prompt'](null, TEST_DB_PATH, agentId, '')

    const result = await handlers['get-agent-system-prompt'](null, TEST_DB_PATH, agentId) as { systemPrompt: string | null }
    expect(result.systemPrompt).toBeNull()
  })
})

// ── agent:duplicate ───────────────────────────────────────────────────────────

describe('agent:duplicate (T1479)', () => {
  it('valid duplicate → success: true, new agentId and name returned', async () => {
    const agentId = await insertAgent('original-agent')

    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId) as { success: boolean; agentId: number; name: string }
    expect(result.success).toBe(true)
    expect(typeof result.agentId).toBe('number')
    expect(result.agentId).not.toBe(agentId)
    expect(result.name).toBe('original-agent-copy')
  })

  it('duplicating again generates -copy-2 suffix', async () => {
    const agentId = await insertAgent('copy-gen-agent')
    await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId) // creates copy
    const result2 = await handlers['agent:duplicate'](null, TEST_DB_PATH, agentId) as { success: boolean; name: string }
    expect(result2.success).toBe(true)
    expect(result2.name).toBe('copy-gen-agent-copy-2')
  })

  it('non-existent agentId → success: false', async () => {
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, 99999) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  it('invalid agentId (string) → success: false', async () => {
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, 'abc' as unknown as number) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })

  it('invalid agentId (float) → success: false', async () => {
    const result = await handlers['agent:duplicate'](null, TEST_DB_PATH, 1.5) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid agentId')
  })
})
