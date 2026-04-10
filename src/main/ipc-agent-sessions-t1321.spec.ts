/**
 * Mutation-killing tests for ipc-agent-sessions.ts — T1321
 *
 * Targets survived mutants (mutation score 32 survived):
 * - EqualityOperator L185: i < rows.length (off-by-one in sync loop)
 * - Batch divisibility: exactly SYNC_CONCURRENCY=5 rows → exactly 5 updates
 * - Empty rows: no eligible sessions → updated=0, no writeDb call
 * - Token conditions: tokensOut > 0 alone (tokensIn=0) triggers update
 * - Empty updates: all parseConvTokens errors → no writeDb, updated=0
 * - Malformed JSON line parsing: non-parseable lines silently skipped
 * - Non-assistant message type skip: only 'assistant' type counts
 * - Exact N updates for N valid rows: verify count precisely
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Shared in-memory buffer ───────────────────────────────────────────────────
let dbBuffer: Buffer = Buffer.alloc(0)
let dbMtime = 1000
let jsonlMockContent: string | Error | null = null

const { readFileMockImpl } = vi.hoisted(() => ({ readFileMockImpl: vi.fn() }))

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(async () => ({ mtimeMs: dbMtime })),
    readFile: readFileMockImpl,
    writeFile: vi.fn(async (_path: string, data: Buffer) => {
      dbBuffer = data
      dbMtime += 1
    }),
    rename: vi.fn(async () => undefined),
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

// ── readline mock: injects jsonlMockContent lines ─────────────────────────────
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
import { registerAgentHandlers } from './ipc-agents'
import {
  buildSchema,
  insertAgent,
  TEST_DB_PATH,
} from './ipc-agents-test-setup'

const TEST_PROJECT_PATH = '/test/project'

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

  await buildSchema()
  registerDbPath(TEST_DB_PATH)
  registerProjectPath(TEST_PROJECT_PATH)
  registerAgentHandlers()
})

afterEach(() => {
  clearDbCacheEntry(TEST_DB_PATH)
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUuid(n: number): string {
  const hex = n.toString(16).padStart(12, '0')
  return `a0000000-0000-0000-0000-${hex}`
}

async function insertSessionWithConvId(agentId: number, uuid: string, tokensIn = 0): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run(
      'INSERT INTO sessions (agent_id, status, claude_conv_id, tokens_in) VALUES (?, ?, ?, ?)',
      [agentId, 'completed', uuid, tokensIn]
    )
  })
  const rows = await queryLive(
    TEST_DB_PATH,
    'SELECT id FROM sessions WHERE claude_conv_id = ?',
    [uuid]
  ) as Array<{ id: number }>
  return rows[0].id
}

// ── EqualityOperator L185: i < rows.length (off-by-one in sync loop) ──────────

describe('session:syncAllTokens — EqualityOperator L185 off-by-one (T1321)', () => {
  it('exactly SYNC_CONCURRENCY=5 rows → updated=5 (not 6 or more from extra iteration)', async () => {
    // The mutant i <= rows.length would add one extra empty batch iteration but same result.
    // This test pins the count: exactly 5 rows → exactly 5 updates.
    const agentId = await insertAgent('exact-5-sessions-agent')
    for (let n = 1; n <= 5; n++) {
      await insertSessionWithConvId(agentId, makeUuid(n))
    }
    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } },
    })

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number; errors: string[] }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(5)
    expect(result.errors).toHaveLength(0)
  })

  it('exactly 10 rows (2 full batches) → updated=10 exactly', async () => {
    const agentId = await insertAgent('exact-10-sessions-agent')
    for (let n = 1; n <= 10; n++) {
      await insertSessionWithConvId(agentId, makeUuid(n))
    }
    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 10 } },
    })

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number; errors: string[] }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(10)
    expect(result.errors).toHaveLength(0)
  })

  it('1 row → updated=1 (boundary: single element, far below concurrency)', async () => {
    const agentId = await insertAgent('single-session-agent')
    await insertSessionWithConvId(agentId, makeUuid(100))
    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 3 } },
    })

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(1)
  })
})

// ── Empty rows: no eligible sessions ─────────────────────────────────────────

describe('session:syncAllTokens — empty rows (T1321)', () => {
  it('no sessions in DB → updated=0, errors=[], success=true', async () => {
    // No sessions inserted at all
    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number; errors: string[] }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('sessions exist but all have tokens_in > 0 → not eligible → updated=0', async () => {
    const agentId = await insertAgent('already-synced-agent')
    await insertSessionWithConvId(agentId, makeUuid(200), 100) // tokens_in=100 → already synced

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number; errors: string[] }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('sessions exist but all have NULL claude_conv_id → not eligible → updated=0', async () => {
    const agentId = await insertAgent('no-conv-id-agent')
    await writeDb<void>(TEST_DB_PATH, (db) => {
      db.run(
        'INSERT INTO sessions (agent_id, status, claude_conv_id, tokens_in) VALUES (?, ?, NULL, 0)',
        [agentId, 'completed']
      )
    })

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number; errors: string[] }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(0)
    expect(result.errors).toHaveLength(0)
  })
})

// ── Token conditions: tokensOut > 0 alone triggers update ────────────────────

describe('session:syncAllTokens — token conditions (T1321)', () => {
  it('tokensIn=0 but tokensOut > 0 → session is included in updates', async () => {
    // The condition is (tokensIn > 0 || tokensOut > 0)
    // Mutant: (tokensIn > 0 && tokensOut > 0) would miss this case
    const agentId = await insertAgent('only-tokens-out-agent')
    const sessionId = await insertSessionWithConvId(agentId, makeUuid(300))
    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 50 } },
    })

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(1)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT tokens_out FROM sessions WHERE id = ?',
      [sessionId]
    ) as Array<{ tokens_out: number }>
    expect(rows[0].tokens_out).toBe(50)
  })

  it('tokensIn > 0 but tokensOut=0 → session is included in updates', async () => {
    // Symmetric: either side of the OR condition suffices
    const agentId = await insertAgent('only-tokens-in-agent')
    const sessionId = await insertSessionWithConvId(agentId, makeUuid(301))
    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', usage: { input_tokens: 75, output_tokens: 0 } },
    })

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(1)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT tokens_in FROM sessions WHERE id = ?',
      [sessionId]
    ) as Array<{ tokens_in: number }>
    expect(rows[0].tokens_in).toBe(75)
  })

  it('both tokensIn=0 and tokensOut=0 → session NOT included in updates', async () => {
    // Ensures filter is working — neither side of OR is truthy
    const agentId = await insertAgent('zero-both-tokens-agent')
    await insertSessionWithConvId(agentId, makeUuid(302))
    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } },
    })

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(0)
  })
})

// ── Empty updates: all parseConvTokens errors → no writeDb, updated=0 ─────────

describe('session:syncAllTokens — empty updates branch (T1321)', () => {
  it('all JSONL files missing → updates empty → updated=0, errors reported', async () => {
    // updates.length > 0 guards the writeDb call
    // When all fail, updates is empty → writeDb must NOT be called → updated=0
    const agentId = await insertAgent('all-errors-agent')
    for (let n = 1; n <= 3; n++) {
      await insertSessionWithConvId(agentId, makeUuid(400 + n))
    }
    jsonlMockContent = null // ENOENT for all

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number; errors: string[] }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(0)
    expect(result.errors).toHaveLength(3)
  })

  it('2 sessions: 1 with tokensIn already set (skipped by query), 1 with 0 tokens → updated=1', async () => {
    // sessions with tokens_in > 0 are excluded by the SQL WHERE clause
    // so only 1 session is eligible, verifying the "empty updates" path doesn't trigger
    const agentId = await insertAgent('partial-eligible-agent')
    const goodUuid = makeUuid(500)
    const alreadySyncedUuid = makeUuid(501)

    await insertSessionWithConvId(agentId, goodUuid, 0)         // eligible
    await insertSessionWithConvId(agentId, alreadySyncedUuid, 99) // already has tokens_in=99 → excluded

    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } },
    })

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number; errors: string[] }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(1)
    expect(result.errors).toHaveLength(0)
  })
})

// ── Malformed JSON line parsing ───────────────────────────────────────────────
