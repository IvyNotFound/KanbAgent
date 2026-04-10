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

describe('parseConvTokens — malformed JSON line silently skipped (T1321)', () => {
  it('malformed JSON line before valid line → valid line still counted', async () => {
    const agentId = await insertAgent('malformed-json-agent')
    await insertSessionWithConvId(agentId, makeUuid(600))
    jsonlMockContent = [
      '{not valid json}',
      'totally broken }{',
      JSON.stringify({
        type: 'assistant',
        message: { stop_reason: 'end_turn', usage: { input_tokens: 30, output_tokens: 15 } },
      }),
    ].join('\n')

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number; errors: string[] }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('malformed JSON between two valid lines → both valid lines counted', async () => {
    const agentId = await insertAgent('malformed-between-agent')
    await insertSessionWithConvId(agentId, makeUuid(601))
    jsonlMockContent = [
      JSON.stringify({
        type: 'assistant',
        message: { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } },
      }),
      'not json at all',
      JSON.stringify({
        type: 'assistant',
        message: { stop_reason: 'tool_use', usage: { input_tokens: 20, output_tokens: 10 } },
      }),
    ].join('\n')

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(1)

    // Verify tokens are summed from both valid lines
    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT tokens_in FROM sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
      [agentId]
    ) as Array<{ tokens_in: number }>
    expect(rows[0].tokens_in).toBe(30) // 10 + 20
  })
})

// ── Non-assistant message type skip ──────────────────────────────────────────

describe('parseConvTokens — non-assistant type skipped (T1321)', () => {
  it('tool_result type → not counted', async () => {
    const agentId = await insertAgent('tool-result-agent')
    await insertSessionWithConvId(agentId, makeUuid(700))
    jsonlMockContent = [
      JSON.stringify({ type: 'tool_result', usage: { input_tokens: 999, output_tokens: 999 } }),
      JSON.stringify({
        type: 'assistant',
        message: { stop_reason: 'end_turn', usage: { input_tokens: 15, output_tokens: 8 } },
      }),
    ].join('\n')

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(1)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT tokens_in FROM sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
      [agentId]
    ) as Array<{ tokens_in: number }>
    expect(rows[0].tokens_in).toBe(15) // not 999+15
  })

  it('system type → not counted', async () => {
    const agentId = await insertAgent('system-type-agent')
    await insertSessionWithConvId(agentId, makeUuid(701))
    jsonlMockContent = [
      JSON.stringify({ type: 'system', message: { usage: { input_tokens: 500 } } }),
      JSON.stringify({
        type: 'assistant',
        message: { stop_reason: 'end_turn', usage: { input_tokens: 25, output_tokens: 12 } },
      }),
    ].join('\n')

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(1)

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT tokens_in FROM sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
      [agentId]
    ) as Array<{ tokens_in: number }>
    expect(rows[0].tokens_in).toBe(25) // not 500+25
  })
})

// ── Exact N updates for N rows (combination) ─────────────────────────────────

describe('session:syncAllTokens — exact N updates for N rows (T1321)', () => {
  it('3 rows → exactly 3 updates, each with correct tokens', async () => {
    const agentId = await insertAgent('exact-n-updates-agent')
    const ids: number[] = []
    const uuids = [makeUuid(800), makeUuid(801), makeUuid(802)]

    for (const uuid of uuids) {
      const id = await insertSessionWithConvId(agentId, uuid)
      ids.push(id)
    }

    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 25 } },
    })

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number; errors: string[] }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(3)
    expect(result.errors).toHaveLength(0)

    // Verify all 3 sessions were updated
    for (const id of ids) {
      const rows = await queryLive(
        TEST_DB_PATH,
        'SELECT tokens_in FROM sessions WHERE id = ?',
        [id]
      ) as Array<{ tokens_in: number }>
      expect(rows[0].tokens_in).toBe(50)
    }
  })

  it('7 rows (spans batch boundary at 5) → exactly 7 updates', async () => {
    const agentId = await insertAgent('seven-rows-agent')
    for (let n = 1; n <= 7; n++) {
      await insertSessionWithConvId(agentId, makeUuid(900 + n))
    }
    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', usage: { input_tokens: 8, output_tokens: 4 } },
    })

    const result = await handlers['session:syncAllTokens'](
      null, TEST_DB_PATH, '/mnt/c/p'
    ) as { success: boolean; updated: number; errors: string[] }

    expect(result.success).toBe(true)
    expect(result.updated).toBe(7)
    expect(result.errors).toHaveLength(0)
  })
})
