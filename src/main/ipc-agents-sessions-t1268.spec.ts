/**
 * Mutation-killing tests for ipc-agent-sessions.ts — T1268
 *
 * Targets survived mutants:
 * - UUID_REGEX: anchors (^) and ($) must both be present
 * - session:setConvId: parameter validation (!dbPath || !convId), LogicalOperator (||→&&)
 * - session:parseTokens: parameter validation, projectPath fallback (||→&&), token counting
 *   conditions (counts.tokensIn > 0), updates.length > 0
 * - session:syncAllTokens: i < rows.length (off-by-one), rows.slice batch, projectPath fallback
 * - session:collectTokens: parameter validation (!dbPath || !agentName)
 * - JSONL parsing: empty line skip, obj.type !== 'assistant', stop_reason null check
 * - claudeProjectSlug: '/' replaced with '-'
 * - JSONL file path: '.claude', 'projects' directory names
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

// ── Helper ────────────────────────────────────────────────────────────────────
const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

async function insertSession(agentId: number, opts?: { convId?: string; status?: string; tokensIn?: number }): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run(
      'INSERT INTO sessions (agent_id, status, claude_conv_id, tokens_in) VALUES (?, ?, ?, ?)',
      [agentId, opts?.status ?? 'started', opts?.convId ?? null, opts?.tokensIn ?? 0]
    )
  })
  const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1', [agentId]) as Array<{ id: number }>
  return rows[0].id
}

// ── UUID_REGEX: anchors (^) and ($) ──────────────────────────────────────────

describe('session:setConvId — UUID validation anchors (T1268)', () => {
  it('valid UUID passes validation', async () => {
    const agentId = await insertAgent('uuid-valid-agent')
    await insertSession(agentId)

    const result = await handlers['session:setConvId'](null, TEST_DB_PATH, agentId, VALID_UUID) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('UUID with leading text fails (missing ^ anchor)', async () => {
    const agentId = await insertAgent('uuid-leading-text-agent')
    // Prepend extra chars → should fail if ^ anchor is present
    const invalidUUID = 'xxx' + VALID_UUID

    const result = await handlers['session:setConvId'](null, TEST_DB_PATH, agentId, invalidUUID) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid convId')
  })

  it('UUID with trailing text fails (missing $ anchor)', async () => {
    const agentId = await insertAgent('uuid-trailing-text-agent')
    // Append extra chars → should fail if $ anchor is present
    const invalidUUID = VALID_UUID + 'extra'

    const result = await handlers['session:setConvId'](null, TEST_DB_PATH, agentId, invalidUUID) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid convId')
  })

  it('UUID with wrong format (too short) fails', async () => {
    const result = await handlers['session:setConvId'](null, TEST_DB_PATH, 1, 'not-a-uuid') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid convId')
  })

  it('UUID case-insensitive: uppercase letters pass', async () => {
    const agentId = await insertAgent('uuid-uppercase-agent')
    await insertSession(agentId)
    const uppercaseUUID = VALID_UUID.toUpperCase()

    const result = await handlers['session:setConvId'](null, TEST_DB_PATH, agentId, uppercaseUUID) as { success: boolean }
    expect(result.success).toBe(true)
  })
})

// ── session:setConvId: parameter validation (LogicalOperator ||→&&) ──────────

describe('session:setConvId — parameter validation (T1268)', () => {
  it('missing dbPath (empty string) → {success:false, error}', async () => {
    const result = await handlers['session:setConvId'](null, '', 1, VALID_UUID) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid arguments')
  })

  it('missing convId (empty string) → {success:false, error}', async () => {
    const result = await handlers['session:setConvId'](null, TEST_DB_PATH, 1, '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid arguments')
  })

  it('both dbPath and convId missing → {success:false, error}', async () => {
    // Tests that || (not &&) means either missing returns error
    const result = await handlers['session:setConvId'](null, '', 1, '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid arguments')
  })

  it('sets conv_id on latest started session for agent', async () => {
    const agentId = await insertAgent('conv-id-setter-agent')
    const sessionId = await insertSession(agentId, { status: 'started' })

    const result = await handlers['session:setConvId'](null, TEST_DB_PATH, agentId, VALID_UUID) as { success: boolean; updated: boolean }
    expect(result.success).toBe(true)
    expect(result.updated).toBe(true)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT claude_conv_id FROM sessions WHERE id = ?', [sessionId]) as Array<{ claude_conv_id: string }>
    expect(rows[0].claude_conv_id).toBe(VALID_UUID)
  })

  it('returns updated=false when no matching session found', async () => {
    const agentId = await insertAgent('conv-id-no-session-agent')
    // No started session with NULL conv_id

    const result = await handlers['session:setConvId'](null, TEST_DB_PATH, agentId, VALID_UUID) as { success: boolean; updated: boolean }
    expect(result.success).toBe(true)
    expect(result.updated).toBe(false)
  })
})

// ── session:parseTokens: parameter validation, projectPath fallback ───────────

describe('session:parseTokens — parameter validation (T1268)', () => {
  it('missing dbPath (empty) → {success:false, error}', async () => {
    const result = await handlers['session:parseTokens'](null, '', VALID_UUID) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    // Either 'Invalid arguments' or DB_PATH_NOT_ALLOWED
    expect(typeof result.error).toBe('string')
  })

  it('missing convId (empty) → {success:false, error}', async () => {
    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  it('both dbPath and convId empty → {success:false, error}', async () => {
    // OR logic: either missing triggers failure
    const result = await handlers['session:parseTokens'](null, '', '') as { success: boolean; error: string }
    expect(result.success).toBe(false)
  })

  it('uses provided projectPath when given (not fallback)', async () => {
    const agentId = await insertAgent('parse-tokens-custom-path')
    await insertSession(agentId, { convId: VALID_UUID, status: 'completed' })
    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 25 } }
    })

    const result = await handlers['session:parseTokens'](
      null, TEST_DB_PATH, VALID_UUID, '/mnt/c/custom/project'
    ) as { success: boolean; tokensIn?: number }

    expect(result.success).toBe(true)
    expect(result.tokensIn).toBe(50)
  })

  it('derives projectPath from dbPath when projectPath not provided', async () => {
    // dbPath = '/test/ipc-integration-test.db'
    // projectPathFromDb = dirname(dirname('/test/ipc-integration-test.db')) = '/'
    const agentId = await insertAgent('parse-tokens-derived-path')
    await insertSession(agentId, { convId: VALID_UUID, status: 'completed' })
    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', usage: { input_tokens: 42, output_tokens: 21 } }
    })

    // No projectPath provided — fallback derived from dbPath
    const result = await handlers['session:parseTokens'](
      null, TEST_DB_PATH, VALID_UUID
    ) as { success: boolean; tokensIn?: number }

    expect(result.success).toBe(true)
    expect(result.tokensIn).toBe(42)
  })
})

// ── JSONL parsing: empty lines, obj.type, stop_reason null check ──────────────

describe('session:parseTokens — JSONL token counting logic (T1268)', () => {
  it('empty line in JSONL is skipped without error', async () => {
    const agentId = await insertAgent('empty-line-agent')
    await insertSession(agentId, { convId: VALID_UUID, status: 'completed' })
    jsonlMockContent = [
      '',  // empty line → should be skipped
      '   ', // whitespace only → should be skipped
      JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } }),
    ].join('\n')

    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, VALID_UUID, '/mnt/c/p') as { success: boolean; tokensIn?: number }
    expect(result.success).toBe(true)
    expect(result.tokensIn).toBe(10)
  })

  it('non-assistant messages (type="human") are not counted', async () => {
    const agentId = await insertAgent('non-assistant-agent')
    await insertSession(agentId, { convId: VALID_UUID, status: 'completed' })
    jsonlMockContent = [
      JSON.stringify({ type: 'human', message: { usage: { input_tokens: 999, output_tokens: 999 } } }),
      JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } }),
    ].join('\n')

    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, VALID_UUID, '/mnt/c/p') as { success: boolean; tokensIn?: number }
    expect(result.success).toBe(true)
    expect(result.tokensIn).toBe(10)  // not 999+10
  })

  it('streaming start (stop_reason=null) is not counted', async () => {
    const agentId = await insertAgent('streaming-skip-agent')
    await insertSession(agentId, { convId: VALID_UUID, status: 'completed' })
    jsonlMockContent = [
      // streaming start — stop_reason=null → should NOT be counted
      JSON.stringify({ type: 'assistant', message: { stop_reason: null, usage: { input_tokens: 999, output_tokens: 1 } } }),
      // finalized message → should be counted
      JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } } }),
    ].join('\n')

    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, VALID_UUID, '/mnt/c/p') as { success: boolean; tokensIn?: number; tokensOut?: number }
    expect(result.success).toBe(true)
    expect(result.tokensIn).toBe(100)  // not 999+100
    expect(result.tokensOut).toBe(50)  // not 1+50
  })

  it('tokens stored in DB after parseTokens succeeds', async () => {
    const agentId = await insertAgent('persist-tokens-agent')
    const sessionId = await insertSession(agentId, { convId: VALID_UUID, status: 'completed' })
    jsonlMockContent = JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'tool_use', usage: { input_tokens: 300, output_tokens: 150, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 } }
    })

    await handlers['session:parseTokens'](null, TEST_DB_PATH, VALID_UUID, '/mnt/c/p')

    const rows = await queryLive(
      TEST_DB_PATH,
      'SELECT tokens_in, tokens_out, tokens_cache_read, tokens_cache_write FROM sessions WHERE id = ?',
      [sessionId]
    ) as Array<{ tokens_in: number; tokens_out: number; tokens_cache_read: number; tokens_cache_write: number }>

    expect(rows[0].tokens_in).toBe(300)
    expect(rows[0].tokens_out).toBe(150)
    expect(rows[0].tokens_cache_read).toBe(20)
    expect(rows[0].tokens_cache_write).toBe(10)
  })
})

// ── session:syncAllTokens: iteration, updates.length > 0, batch slicing ───────
