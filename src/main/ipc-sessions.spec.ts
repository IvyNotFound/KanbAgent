/**
 * Integration tests — IPC session handlers — T985
 *
 * Covers:
 * - session:updateResult
 * - sessions:statsCost
 * - close-agent-sessions
 * - session:setConvId
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
import { getSqlJs, registerDbPath, registerProjectPath, clearDbCacheEntry, queryLive, writeDb } from './db'
import { registerIpcHandlers } from './ipc'
import {
  buildSchema,
  insertAgent,
  insertSession,
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

// Suppress unused import warnings — helpers re-exported from ipc-test-setup
void getSqlJs
void writeDb

// ── Tests: session:updateResult ───────────────────────────────────────────────

describe('session:updateResult (T985)', () => {
  it('updates cost_usd, duration_ms, num_turns for a valid session', async () => {
    const agentId = await insertAgent('agent-cost')
    const sessionId = await insertSession(agentId)

    const result = await handlers['session:updateResult'](
      null, TEST_DB_PATH, sessionId,
      { cost_usd: 0.0042, duration_ms: 12345, num_turns: 7 }
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT cost_usd, duration_ms, num_turns FROM sessions WHERE id = ?',
      [sessionId]
    ) as Array<{ cost_usd: number; duration_ms: number; num_turns: number }>
    expect(rows[0].cost_usd).toBeCloseTo(0.0042)
    expect(rows[0].duration_ms).toBe(12345)
    expect(rows[0].num_turns).toBe(7)
  })

  it('returns { success: false, error: INVALID_SESSION_ID } for non-integer sessionId', async () => {
    const result = await handlers['session:updateResult'](
      null, TEST_DB_PATH, 1.5, { cost_usd: 1.0 }
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toBe('INVALID_SESSION_ID')
  })

  it('returns { success: false, error: INVALID_SESSION_ID } for sessionId <= 0', async () => {
    const result = await handlers['session:updateResult'](
      null, TEST_DB_PATH, 0, { cost_usd: 1.0 }
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toBe('INVALID_SESSION_ID')
  })

  it('accepts null fields and stores NULL in DB', async () => {
    const agentId = await insertAgent('agent-null-cost')
    const sessionId = await insertSession(agentId)

    const result = await handlers['session:updateResult'](
      null, TEST_DB_PATH, sessionId,
      { cost_usd: null, duration_ms: null, num_turns: null }
    ) as { success: boolean }

    expect(result.success).toBe(true)
    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT cost_usd, duration_ms, num_turns FROM sessions WHERE id = ?',
      [sessionId]
    ) as Array<{ cost_usd: null; duration_ms: null; num_turns: null }>
    expect(rows[0].cost_usd).toBeNull()
    expect(rows[0].duration_ms).toBeNull()
    expect(rows[0].num_turns).toBeNull()
  })

  it('rejects unregistered dbPath', async () => {
    await expect(
      handlers['session:updateResult'](null, '/evil/db.db', 1, { cost_usd: 1.0 })
    ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
  })
})

// ── Tests: sessions:statsCost ─────────────────────────────────────────────────

describe('sessions:statsCost (T985)', () => {
  it('returns { success: false, error: INVALID_PERIOD } for unknown period', async () => {
    const result = await handlers['sessions:statsCost'](
      null, TEST_DB_PATH, { period: 'year' }
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toBe('INVALID_PERIOD')
  })

  it('returns { success: true, rows: [] } when no sessions have cost_usd', async () => {
    const agentId = await insertAgent('agent-stats')
    await insertSession(agentId, { status: 'completed' })

    const result = await handlers['sessions:statsCost'](
      null, TEST_DB_PATH, { period: 'day' }
    ) as { success: boolean; rows: unknown[] }

    expect(result.success).toBe(true)
    expect(result.rows).toHaveLength(0)
  })

  it('aggregates cost per agent per day', async () => {
    const agentId = await insertAgent('agent-agg')
    await insertSession(agentId, { status: 'completed', costUsd: 0.01, startedAt: '2026-03-01 10:00:00' })
    await insertSession(agentId, { status: 'completed', costUsd: 0.02, startedAt: '2026-03-01 11:00:00' })

    const result = await handlers['sessions:statsCost'](
      null, TEST_DB_PATH, { period: 'day', limit: 10 }
    ) as { success: boolean; rows: Array<{ agent_name: string; total_cost: number; session_count: number }> }

    expect(result.success).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].agent_name).toBe('agent-agg')
    expect(result.rows[0].session_count).toBe(2)
    expect(result.rows[0].total_cost).toBeCloseTo(0.03, 4)
  })

  it('filters by agentId when provided', async () => {
    const agentA = await insertAgent('agent-stats-a')
    const agentB = await insertAgent('agent-stats-b')
    await insertSession(agentA, { status: 'completed', costUsd: 0.05, startedAt: '2026-03-01 10:00:00' })
    await insertSession(agentB, { status: 'completed', costUsd: 0.10, startedAt: '2026-03-01 10:00:00' })

    const result = await handlers['sessions:statsCost'](
      null, TEST_DB_PATH, { period: 'day', agentId: agentA, limit: 10 }
    ) as { success: boolean; rows: Array<{ agent_name: string }> }

    expect(result.success).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].agent_name).toBe('agent-stats-a')
  })

  it('rejects unregistered dbPath', async () => {
    await expect(
      handlers['sessions:statsCost'](null, '/evil/db.db', { period: 'day' })
    ).rejects.toThrow('DB_PATH_NOT_ALLOWED')
  })
})

// ── Tests: close-agent-sessions ───────────────────────────────────────────────

describe('close-agent-sessions (T985)', () => {
  it('marks all started sessions as completed for an agent', async () => {
    const agentId = await insertAgent('agent-close-sessions')
    await insertSession(agentId, { status: 'started' })
    await insertSession(agentId, { status: 'started' })

    const result = await handlers['close-agent-sessions'](
      null, TEST_DB_PATH, 'agent-close-sessions'
    ) as { success: boolean }

    expect(result.success).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT status FROM sessions WHERE agent_id = ?',
      [agentId]
    ) as Array<{ status: string }>
    expect(rows.every(r => r.status === 'completed')).toBe(true)
  })

  it('does not affect other agents sessions', async () => {
    const agentA = await insertAgent('agent-close-a')
    const agentB = await insertAgent('agent-close-b')
    await insertSession(agentA, { status: 'started' })
    await insertSession(agentB, { status: 'started' })

    await handlers['close-agent-sessions'](null, TEST_DB_PATH, 'agent-close-a')

    const rowsB = await queryLive(
      TEST_DB_PATH,
      'SELECT status FROM sessions WHERE agent_id = ?',
      [agentB]
    ) as Array<{ status: string }>
    expect(rowsB[0].status).toBe('started')
  })

  it('returns { success: true } when agent has no started sessions', async () => {
    await insertAgent('agent-no-sessions')

    const result = await handlers['close-agent-sessions'](
      null, TEST_DB_PATH, 'agent-no-sessions'
    ) as { success: boolean }

    expect(result.success).toBe(true)
  })

  it('returns { success: false } for unregistered dbPath', async () => {
    const result = await handlers['close-agent-sessions'](
      null, '/evil/db.db', 'agent-name'
    ) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})

// ── Tests: session:setConvId ──────────────────────────────────────────────────

describe('session:setConvId (T985)', () => {
  const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  it('sets claude_conv_id on the latest started session for an agent', async () => {
    const agentId = await insertAgent('agent-conv')
    const sessionId = await insertSession(agentId, { status: 'started' })

    const result = await handlers['session:setConvId'](
      null, TEST_DB_PATH, agentId, VALID_UUID
    ) as { success: boolean; updated: boolean }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(true)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT claude_conv_id FROM sessions WHERE id = ?',
      [sessionId]
    ) as Array<{ claude_conv_id: string }>
    expect(rows[0].claude_conv_id).toBe(VALID_UUID)
  })

  it('returns { success: true, updated: false } when no matching session found', async () => {
    const agentId = await insertAgent('agent-no-conv-session')

    const result = await handlers['session:setConvId'](
      null, TEST_DB_PATH, agentId, VALID_UUID
    ) as { success: boolean; updated: boolean }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(false)
  })

  it('does not overwrite existing claude_conv_id (already set)', async () => {
    const agentId = await insertAgent('agent-conv-existing')
    await insertSession(agentId, { status: 'started', convId: 'existing-uuid' })

    const result = await handlers['session:setConvId'](
      null, TEST_DB_PATH, agentId, VALID_UUID
    ) as { success: boolean; updated: boolean }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(false)
  })

  it('returns { success: false } for invalid arguments', async () => {
    const result1 = await handlers['session:setConvId'](null, '', 1, VALID_UUID) as { success: boolean }
    const result3 = await handlers['session:setConvId'](null, TEST_DB_PATH, 1, '') as { success: boolean }

    expect(result1.success).toBe(false)
    expect(result3.success).toBe(false)
  })

  it('rejects unregistered dbPath', async () => {
    const result = await handlers['session:setConvId'](
      null, '/evil/db.db', 1, VALID_UUID
    ) as { success: boolean; error: string }

    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })
})
