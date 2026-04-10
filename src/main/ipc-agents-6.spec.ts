/**
 * IPC agent handler tests — File 6 of 6
 * Covers: session:parseTokens (T581), session:syncAllTokens (T581),
 *         session:collectTokens (T581), task:getLinks (T673)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let dbBuffer: Buffer = Buffer.alloc(0)
let dbMtime = 1000
// jsonlMockContent: injected JSONL content for .jsonl reads
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

vi.mock('readline', async () => {
  const { EventEmitter } = await import('events')
  const createInterface = vi.fn(({ input }: { input: NodeJS.ReadableStream }) => {
    input.on('error', () => {})
    if ('destroy' in input && typeof input.destroy === 'function') input.destroy()

    const rl = new EventEmitter() as NodeJS.EventEmitter & { close: () => void }
    rl.close = () => {}
    setImmediate(() => {
      if (jsonlMockContent instanceof Error) {
        rl.emit('error', jsonlMockContent)
        return
      }
      if (jsonlMockContent === null) {
        rl.emit('error', new Error('ENOENT: no such file'))
        return
      }
      for (const line of jsonlMockContent.split('\n')) {
        rl.emit('line', line)
      }
      rl.emit('close')
    })
    return rl
  })
  return {
    createInterface,
    default: { createInterface },
  }
})

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

import { registerDbPath, clearDbCacheEntry, queryLive, writeDb } from './db'
import { registerAgentHandlers } from './ipc-agents'
import { buildSchema, TEST_DB_PATH, insertAgent, insertTask } from './ipc-agents-test-setup'

beforeEach(async () => {
  vi.clearAllMocks()
  jsonlMockContent = null
  clearDbCacheEntry(TEST_DB_PATH)
  dbMtime = 1000

  // Restore readFileMockImpl implementation after clearAllMocks resets it
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

const VALID_CONV_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

// Helper JSONL with 2 finalized assistant messages (streaming start skipped)
const VALID_JSONL = [
  JSON.stringify({ type: 'assistant', message: { stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } } }),
  JSON.stringify({ type: 'assistant', message: { stop_reason: null, usage: { input_tokens: 99, output_tokens: 1 } } }), // streaming start — should be skipped
  JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 20 } } }),
  'not-valid-json-line', // malformed — should be skipped
].join('\n')

async function insertSession(agentId: number, convId?: string): Promise<number> {
  await writeDb<void>(TEST_DB_PATH, (db) => {
    db.run('INSERT INTO sessions (agent_id, status, claude_conv_id) VALUES (?, ?, ?)', [agentId, 'completed', convId ?? null])
  })
  const rows = await queryLive(TEST_DB_PATH, 'SELECT id FROM sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1', [agentId]) as Array<{ id: number }>
  return rows[0].id
}

describe('session:parseTokens (T581)', () => {
  it('returns DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
    const result = await handlers['session:parseTokens'](null, '/evil/db.db', VALID_CONV_ID) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('returns { success: false } for empty convId', async () => {
    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, '') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  it('returns { success: false, error: "Invalid convId format" } for non-UUID convId', async () => {
    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, 'not-a-uuid') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid convId format')
  })

  it('parses valid JSONL and returns summed token counts', async () => {
    const agentId = await insertAgent('parse-tokens-agent')
    await insertSession(agentId, VALID_CONV_ID)
    jsonlMockContent = VALID_JSONL

    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, VALID_CONV_ID, '/mnt/c/project') as {
      success: boolean; tokensIn?: number; tokensOut?: number; cacheRead?: number; cacheWrite?: number
    }
    expect(result.success).toBe(true)
    // streaming start (stop_reason=null) skipped → only 2 finalized messages counted
    expect(result.tokensIn).toBe(300)   // 100 + 200
    expect(result.tokensOut).toBe(130)  // 50 + 80
    expect(result.cacheRead).toBe(10)   // 10 + 0
    expect(result.cacheWrite).toBe(25)  // 5 + 20
  })

  it('returns { success: false } when JSONL file not found', async () => {
    jsonlMockContent = null // readline mock will emit ENOENT
    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, VALID_CONV_ID, '/mnt/c/project') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('ENOENT')
  })

  it('ignores malformed JSON lines without crashing', async () => {
    const jsonlWithGarbage = 'garbage-line\n' + JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } })
    const agentId = await insertAgent('malformed-jsonl-agent')
    await insertSession(agentId, VALID_CONV_ID)
    jsonlMockContent = jsonlWithGarbage

    const result = await handlers['session:parseTokens'](null, TEST_DB_PATH, VALID_CONV_ID, '/mnt/c/project') as { success: boolean; tokensIn?: number }
    expect(result.success).toBe(true)
    expect(result.tokensIn).toBe(10)
  })
})

// ── Tests: session:syncAllTokens (T581) ───────────────────────────────────────

describe('session:syncAllTokens (T581)', () => {
  it('returns DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
    const result = await handlers['session:syncAllTokens'](null, '/evil/db.db') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('returns { success: true, updated: 0 } when no sessions have convId', async () => {
    const agentId = await insertAgent('sync-no-conv-agent')
    await insertSession(agentId) // no convId

    const result = await handlers['session:syncAllTokens'](null, TEST_DB_PATH, '/mnt/c/project') as { success: boolean; updated: number }
    expect(result.success).toBe(true)
    expect(result.updated).toBe(0)
  })

  it('updates sessions with convId and nonzero tokens, returns updated count', async () => {
    const agentId = await insertAgent('sync-tokens-agent')
    const sessionId = await insertSession(agentId, VALID_CONV_ID)
    jsonlMockContent = VALID_JSONL

    const result = await handlers['session:syncAllTokens'](null, TEST_DB_PATH, '/mnt/c/project') as { success: boolean; updated: number; errors: string[] }
    expect(result.success).toBe(true)
    expect(result.updated).toBe(1)
    expect(result.errors).toHaveLength(0)

    const rows = await queryLive(TEST_DB_PATH, 'SELECT tokens_in FROM sessions WHERE id = ?', [sessionId]) as Array<{ tokens_in: number }>
    expect(rows[0].tokens_in).toBe(300)
  })

  it('skips sessions where JSONL file is missing (error captured, not thrown)', async () => {
    const agentId = await insertAgent('sync-missing-jsonl-agent')
    await insertSession(agentId, VALID_CONV_ID)
    jsonlMockContent = null // readline mock will emit ENOENT

    const result = await handlers['session:syncAllTokens'](null, TEST_DB_PATH, '/mnt/c/project') as { success: boolean; updated: number; errors: string[] }
    expect(result.success).toBe(true)
    expect(result.updated).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('ENOENT')
  })
})

// ── Tests: session:collectTokens (T581) ───────────────────────────────────────

describe('session:collectTokens (T581)', () => {
  it('returns DB_PATH_NOT_ALLOWED for unregistered dbPath', async () => {
    const result = await handlers['session:collectTokens'](null, '/evil/db.db', 'myagent') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('DB_PATH_NOT_ALLOWED')
  })

  it('returns { success: false } for empty agentName', async () => {
    const result = await handlers['session:collectTokens'](null, TEST_DB_PATH, '') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  it('returns { success: true, tokens: null } when agent has no sessions with convId', async () => {
    await insertAgent('collect-no-session-agent')
    const result = await handlers['session:collectTokens'](null, TEST_DB_PATH, 'collect-no-session-agent') as { success: boolean; tokens: unknown }
    expect(result.success).toBe(true)
    expect(result.tokens).toBeNull()
  })

  it('returns aggregated tokens for agent with convId session', async () => {
    const agentId = await insertAgent('collect-tokens-agent')
    await insertSession(agentId, VALID_CONV_ID)
    jsonlMockContent = VALID_JSONL

    const result = await handlers['session:collectTokens'](null, TEST_DB_PATH, 'collect-tokens-agent') as {
      success: boolean; tokens: { tokensIn: number; tokensOut: number } | null
    }
    expect(result.success).toBe(true)
    expect(result.tokens).not.toBeNull()
    expect(result.tokens!.tokensIn).toBe(300)
    expect(result.tokens!.tokensOut).toBe(130)
  })
})

// ── Tests: task:getLinks (T673) ───────────────────────────────────────────────
